import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource, EntityManager } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { Money } from '@domain/money/money.ts';
import { Wallet } from '@domain/wallet/wallet.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const composeArgs = ['-f', 'docker-compose.test.yml'] as const;

async function dockerComposeAvailable(): Promise<boolean> {
  try {
    const child = Bun.spawn(['docker', 'compose', 'version'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await child.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function runDockerCompose(args: readonly string[]): Promise<void> {
  const child = Bun.spawn(['docker', 'compose', ...composeArgs, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(`docker compose ${args.join(' ')} falhou: ${stderr}`);
  }
}

const hasDockerCompose = await dockerComposeAvailable();
const describeIfDocker = hasDockerCompose ? describe : describe.skip;

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-01-01T00:00:00.000Z');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let AppDataSource: DataSource | undefined;
let unitOfWork: UnitOfWork | undefined;
let repository: WalletRepository | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function uow(): UnitOfWork {
  if (unitOfWork === undefined) {
    throw new Error('UnitOfWork não inicializado — beforeAll falhou');
  }
  return unitOfWork;
}

function repo(): WalletRepository {
  if (repository === undefined) {
    throw new Error('WalletRepository não inicializado — beforeAll falhou');
  }
  return repository;
}

describeIfDocker('TypeOrmWalletRepository — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/typeorm-unit-of-work.ts'
    );
    const { TypeOrmWalletRepository } = await import(
      '@infrastructure/persistence/typeorm-wallet-repository.ts'
    );
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
    repository = new TypeOrmWalletRepository(new FixedClock());
  }, 60_000);

  afterAll(async () => {
    try {
      if (AppDataSource?.isInitialized === true) {
        await AppDataSource.destroy();
      }
    } finally {
      await runDockerCompose(['down', '-v']);
    }
  }, 30_000);

  it('insere e recarrega uma wallet com os mesmos dados', async () => {
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      currency: 'BRL',
      initialBalance: Money.from({ amount: '150.00', currency: 'BRL' }),
    });

    await uow().run(async (ctx) => {
      await repo().insert(ctx, wallet);
    });

    const found = await uow().run((ctx) => repo().findByIdForUpdate(ctx, wallet.id));

    expect(found).toBeDefined();
    expect(found?.id).toBe(wallet.id);
    expect(found?.playerId).toBe(wallet.playerId);
    expect(found?.currency).toBe('BRL');
    expect(found?.balance().toJSON().amount).toBe('150.00');
    expect(found?.version()).toBe(1);
  });

  it('retorna undefined para um id inexistente', async () => {
    const found = await uow().run((ctx) => repo().findByIdForUpdate(ctx, crypto.randomUUID()));
    expect(found).toBeUndefined();
  });

  it('encontra por playerId e currency', async () => {
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      currency: 'BRL',
    });

    await uow().run(async (ctx) => {
      await repo().insert(ctx, wallet);
    });

    const found = await uow().run((ctx) =>
      repo().findByPlayerAndCurrency(ctx, wallet.playerId, 'BRL'),
    );
    expect(found?.id).toBe(wallet.id);

    const notFound = await uow().run((ctx) =>
      repo().findByPlayerAndCurrency(ctx, wallet.playerId, 'USD'),
    );
    expect(notFound).toBeUndefined();
  });

  it('persiste alterações de saldo e versão feitas por update', async () => {
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      currency: 'BRL',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    await uow().run(async (ctx) => {
      await repo().insert(ctx, wallet);
    });

    await uow().run(async (ctx) => {
      const loaded = await repo().findByIdForUpdate(ctx, wallet.id);
      loaded?.credit({
        entryId: crypto.randomUUID(),
        transactionId: crypto.randomUUID(),
        money: Money.from({ amount: '50.00', currency: 'BRL' }),
        createdAt: new Date(),
      });
      if (loaded !== undefined) {
        await repo().update(ctx, loaded);
      }
    });

    const after = await uow().run((ctx) => repo().findByIdForUpdate(ctx, wallet.id));
    expect(after?.balance().toJSON().amount).toBe('150.00');
    expect(after?.version()).toBe(2);
  });

  it('lança em runtime ao tentar lock pessimista fora de uma transação', async () => {
    const manager = dataSource().manager as EntityManager;
    await expect(
      manager.findOne(
        (
          await import('@infrastructure/persistence/entities/wallet.entity.ts')
        ).WalletEntity,
        { where: { id: crypto.randomUUID() }, lock: { mode: 'pessimistic_write' } },
      ),
    ).rejects.toThrow();
  });

  it('serializa duas transações concorrentes que disputam o lock da mesma wallet', async () => {
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      currency: 'BRL',
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    await uow().run(async (ctx) => {
      await repo().insert(ctx, wallet);
    });

    const order: string[] = [];

    const first = uow().run(async (ctx) => {
      const loaded = await repo().findByIdForUpdate(ctx, wallet.id);
      order.push('first-locked');
      await sleep(200);
      loaded?.credit({
        entryId: crypto.randomUUID(),
        transactionId: crypto.randomUUID(),
        money: Money.from({ amount: '1.00', currency: 'BRL' }),
        createdAt: new Date(),
      });
      if (loaded !== undefined) {
        await repo().update(ctx, loaded);
      }
      order.push('first-committed');
    });

    await sleep(50);

    const second = uow().run(async (ctx) => {
      const loaded = await repo().findByIdForUpdate(ctx, wallet.id);
      order.push('second-locked');
      loaded?.credit({
        entryId: crypto.randomUUID(),
        transactionId: crypto.randomUUID(),
        money: Money.from({ amount: '2.00', currency: 'BRL' }),
        createdAt: new Date(),
      });
      if (loaded !== undefined) {
        await repo().update(ctx, loaded);
      }
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first-locked', 'first-committed', 'second-locked']);

    const final = await uow().run((ctx) => repo().findByIdForUpdate(ctx, wallet.id));
    expect(final?.balance().toJSON().amount).toBe('13.00');
    expect(final?.version()).toBe(3);
  });
});
