import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource, EntityManager } from 'typeorm';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

let AppDataSource: DataSource | undefined;
let unitOfWork: UnitOfWork | undefined;

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

async function countAllTables(): Promise<Record<string, number>> {
  const tables = [
    'wallets',
    'wager_transactions',
    'wallet_ledger_entries',
    'inbox_messages',
    'outbox_messages',
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await dataSource().query(`SELECT count(*)::int AS c FROM ${table}`);
    counts[table] = (rows as { c: number }[])[0]!.c;
  }
  return counts;
}

describeIfDocker('UnitOfWork — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
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

  it('commita quando o trabalho conclui com sucesso', async () => {
    const before = await countAllTables();

    await uow().run(async (ctx) => {
      const manager = ctx as EntityManager;
      await manager.query(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 100.00, 1, now(), now())`,
      );
    });

    const after = await countAllTables();
    expect(after['wallets']).toBe(before['wallets']! + 1);
  });

  it('reverte todas as escritas quando o trabalho lanca no meio da unidade', async () => {
    const before = await countAllTables();

    await expect(
      uow().run(async (ctx) => {
        const manager = ctx as EntityManager;

        const walletRows = await manager.query(
          `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
           VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 100.00, 1, now(), now())
           RETURNING id`,
        );
        const walletId = (walletRows as { id: string }[])[0]!.id;

        const txRows = await manager.query(
          `INSERT INTO wager_transactions
             (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
              wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
           VALUES (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '25.00', 'BRL', 'PROCESSED', now())
           RETURNING id`,
          [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID()],
        );
        const transactionId = (txRows as { id: string }[])[0]!.id;

        await manager.query(
          `INSERT INTO wallet_ledger_entries
             (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount, balance_after_amount, currency, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'DEBIT', '25.00', '100.00', '75.00', 'BRL', now())`,
          [walletId, transactionId],
        );

        throw new Error('falha forçada no meio da unidade de trabalho');
      }),
    ).rejects.toThrow('falha forçada no meio da unidade de trabalho');

    const after = await countAllTables();
    expect(after).toEqual(before);
  });

  it('cada chamada a run fornece um EntityManager transacional distinto', async () => {
    let firstManager: unknown;
    let secondManager: unknown;

    await uow().run(async (ctx) => {
      firstManager = ctx;
    });
    await uow().run(async (ctx) => {
      secondManager = ctx;
    });

    expect(firstManager).toBeDefined();
    expect(secondManager).toBeDefined();
    expect(firstManager).not.toBe(secondManager);
  });
});
