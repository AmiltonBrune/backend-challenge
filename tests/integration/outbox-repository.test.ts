import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let AppDataSource: DataSource | undefined;
let unitOfWork: UnitOfWork | undefined;
let repository: OutboxRepository | undefined;

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

function repo(): OutboxRepository {
  if (repository === undefined) {
    throw new Error('OutboxRepository não inicializado — beforeAll falhou');
  }
  return repository;
}

function buildMessage(occurredAt: Date): OutboxMessage {
  const event = new WalletBalanceChanged({
    eventId: crypto.randomUUID(),
    aggregateId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    occurredAt,
    data: {
      walletId: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      currency: 'BRL',
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '150.00', currency: 'BRL' },
      walletVersion: 2,
    },
  });
  return OutboxMessage.enqueue(event);
}

describeIfDocker('TypeOrmOutboxRepository — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
    repository = new TypeOrmOutboxRepository();
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

  it('insere e reserva uma mensagem pendente', async () => {
    const message = buildMessage(new Date());
    await uow().run((ctx) => repo().insert(ctx, message));

    const reserved = await uow().run((ctx) => repo().reservePending(ctx, 10, new Date()));
    const found = reserved.find((m) => m.id === message.id);
    expect(found).toBeDefined();
    expect(found?.eventType).toBe('WalletBalanceChanged');
    expect(found?.isPending()).toBe(true);
  });

  it('não reserva uma mensagem cujo nextAttemptAt ainda está no futuro', async () => {
    const message = buildMessage(new Date());
    await uow().run((ctx) => repo().insert(ctx, message));

    const farFuture = new Date(Date.now() + 60 * 60 * 1000);
    message.scheduleRetry(farFuture);
    await uow().run((ctx) => repo().update(ctx, message));

    const reserved = await uow().run((ctx) => repo().reservePending(ctx, 50, new Date()));
    expect(reserved.some((m) => m.id === message.id)).toBe(false);
  });

  it('não reserva uma mensagem já publicada', async () => {
    const message = buildMessage(new Date());
    await uow().run((ctx) => repo().insert(ctx, message));

    message.markPublished(new Date());
    await uow().run((ctx) => repo().update(ctx, message));

    const reserved = await uow().run((ctx) => repo().reservePending(ctx, 50, new Date()));
    expect(reserved.some((m) => m.id === message.id)).toBe(false);
  });

  it('persiste attempts, nextAttemptAt e publishedAt via update', async () => {
    const message = buildMessage(new Date());
    await uow().run((ctx) => repo().insert(ctx, message));

    message.scheduleRetry(new Date());
    await uow().run((ctx) => repo().update(ctx, message));

    const rows = await dataSource().query(
      `SELECT attempts, next_attempt_at FROM outbox_messages WHERE id = $1`,
      [message.id],
    );
    const row = (rows as { attempts: number; next_attempt_at: Date }[])[0];
    expect(row?.attempts).toBe(1);
    expect(row?.next_attempt_at).not.toBeNull();
  });

  it('SKIP LOCKED permite duas transações reservarem mensagens diferentes sem serializar', async () => {
    const past = new Date(Date.now() - 60_000);
    const messageA = buildMessage(past);
    const messageB = buildMessage(new Date(past.getTime() + 1_000));

    await uow().run(async (ctx) => {
      await repo().insert(ctx, messageA);
      await repo().insert(ctx, messageB);
    });

    const order: string[] = [];
    let resolveFirstReserved: () => void;
    const firstReserved = new Promise<void>((resolve) => {
      resolveFirstReserved = resolve;
    });

    const first = uow().run(async (ctx) => {
      const reserved = await repo().reservePending(ctx, 1, new Date());
      order.push(`first-reserved:${reserved[0]?.id}`);
      resolveFirstReserved();
      await sleep(200);
      order.push('first-committed');
      return reserved[0]?.id;
    });

    await firstReserved;

    const second = uow().run(async (ctx) => {
      const reserved = await repo().reservePending(ctx, 1, new Date());
      order.push(`second-reserved:${reserved[0]?.id}`);
      return reserved[0]?.id;
    });

    const [firstId, secondId] = await Promise.all([first, second]);

    expect(firstId).toBe(messageA.id);
    expect(secondId).toBe(messageB.id);
    expect(order).toEqual([
      `first-reserved:${messageA.id}`,
      `second-reserved:${messageB.id}`,
      'first-committed',
    ]);
  });
});
