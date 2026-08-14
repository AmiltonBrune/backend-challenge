import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { GetWalletUseCase } from '@application/use-cases/get-wallet-use-case.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

let AppDataSource: DataSource | undefined;
let useCase: GetWalletUseCase | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function getWallet(): GetWalletUseCase {
  if (useCase === undefined) {
    throw new Error('GetWalletUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
}

describeIfDocker('GetWalletUseCase — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmWalletRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts'
    );
    const { GetWalletUseCase } = await import('@application/use-cases/get-wallet-use-case.ts');

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    useCase = new GetWalletUseCase(
      new TypeOrmUnitOfWork(AppDataSource),
      new TypeOrmWalletRepository({ now: () => new Date() }),
    );
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

  it('retorna a view completa, incluindo updatedAt real do banco', async () => {
    const playerId = crypto.randomUUID();
    const rows = await dataSource().query(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'BRL', '250.00', 2, now(), now())
       RETURNING id, updated_at`,
      [playerId],
    );
    const walletId = (rows as { id: string; updated_at: Date }[])[0]!.id;
    const updatedAt = (rows as { id: string; updated_at: Date }[])[0]!.updated_at;

    const result = await getWallet().execute({ walletId });

    expect(result.id).toBe(walletId);
    expect(result.playerId).toBe(playerId);
    expect(result.balance.amount).toBe('250.00');
    expect(result.version).toBe(2);
    expect(result.updatedAt.toISOString()).toBe(updatedAt.toISOString());
  });

  it('lança WalletNotFoundError para uma wallet inexistente', async () => {
    await expect(getWallet().execute({ walletId: crypto.randomUUID() })).rejects.toThrow(
      WalletNotFoundError,
    );
  });
});
