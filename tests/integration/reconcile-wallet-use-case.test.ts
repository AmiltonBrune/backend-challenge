import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { ReconcileWalletUseCase } from '@application/use-cases/reconcile-wallet-use-case.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let AppDataSource: DataSource | undefined;
let useCase: ReconcileWalletUseCase | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function reconcile(): ReconcileWalletUseCase {
  if (useCase === undefined) {
    throw new Error('ReconcileWalletUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
}

async function insertWalletWithOpening(balance: string): Promise<string> {
  const playerId = crypto.randomUUID();
  const walletRows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'BRL', $2, 1, now(), now())
     RETURNING id`,
    [playerId, balance],
  );
  const walletId = (walletRows as { id: string }[])[0]!.id;

  const txRows = await dataSource().query(
    `INSERT INTO wager_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
     VALUES (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'OPENING', $5, 'BRL', 'PROCESSED', now())
     RETURNING id`,
    [crypto.randomUUID(), crypto.randomUUID(), walletId, playerId, balance],
  );
  const transactionId = (txRows as { id: string }[])[0]!.id;

  await dataSource().query(
    `INSERT INTO wallet_ledger_entries
       (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount, balance_after_amount, currency, created_at)
     VALUES (gen_random_uuid(), $1, $2, 'CREDIT', $3, '0.00', $3, 'BRL', now())`,
    [walletId, transactionId, balance],
  );

  return walletId;
}

describeIfDocker('ReconcileWalletUseCase — contra Postgres real', () => {
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
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );
    const { ReconcileWalletUseCase } = await import(
      '@application/use-cases/reconcile-wallet-use-case.ts'
    );

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    useCase = new ReconcileWalletUseCase(
      new TypeOrmUnitOfWork(AppDataSource),
      new TypeOrmWalletRepository({ now: () => new Date() }),
      new TypeOrmLedgerRepository(),
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

  it('reporta consistent:true para uma wallet íntegra, com checkedEntries correto', async () => {
    const walletId = await insertWalletWithOpening('150.00');

    const result = await reconcile().execute({ walletId });

    expect(result.consistent).toBe(true);
    expect(result.storedBalance.amount).toBe('150.00');
    expect(result.calculatedBalance.amount).toBe('150.00');
    expect(result.difference.amount).toBe('0.00');
    expect(result.checkedEntries).toBe(1);
  });

  it('reporta consistent:false quando o saldo armazenado diverge do ledger (corrupção simulada)', async () => {
    const walletId = await insertWalletWithOpening('100.00');
    await dataSource().query(`UPDATE wallets SET balance_amount = '999.00' WHERE id = $1`, [walletId]);

    const result = await reconcile().execute({ walletId });

    expect(result.consistent).toBe(false);
    expect(result.storedBalance.amount).toBe('999.00');
    expect(result.calculatedBalance.amount).toBe('100.00');
    expect(result.difference.amount).toBe('899.00');
  });

  it('lança WalletNotFoundError para uma wallet inexistente', async () => {
    await expect(reconcile().execute({ walletId: crypto.randomUUID() })).rejects.toThrow(
      WalletNotFoundError,
    );
  });

  it('REPEATABLE READ preserva o snapshot mesmo com um commit concorrente no meio da leitura', async () => {
    const walletId = await insertWalletWithOpening('100.00');

    const queryRunner = dataSource().createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('REPEATABLE READ');

    try {
      const firstRead = await queryRunner.query(
        `SELECT balance_amount FROM wallets WHERE id = $1`,
        [walletId],
      );
      expect((firstRead as { balance_amount: string }[])[0]?.balance_amount).toBe('100.00');

      await dataSource().query(`UPDATE wallets SET balance_amount = '30.00' WHERE id = $1`, [
        walletId,
      ]);

      await sleep(50);

      const secondRead = await queryRunner.query(
        `SELECT balance_amount FROM wallets WHERE id = $1`,
        [walletId],
      );
      expect((secondRead as { balance_amount: string }[])[0]?.balance_amount).toBe('100.00');
    } finally {
      await queryRunner.commitTransaction();
      await queryRunner.release();
    }

    const afterCommit = await dataSource().query(
      `SELECT balance_amount FROM wallets WHERE id = $1`,
      [walletId],
    );
    expect((afterCommit as { balance_amount: string }[])[0]?.balance_amount).toBe('30.00');
  });
});
