import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

let AppDataSource: DataSource | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

async function insertWallet(): Promise<string> {
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 1000.00, 1, now(), now())
     RETURNING id`,
  );
  return (rows as { id: string }[])[0]!.id;
}

async function insertTransaction(overrides: Record<string, unknown>): Promise<void> {
  const base = {
    provider_id: 'provider-a',
    external_transaction_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    payload_hash: 'hash',
    player_id: crypto.randomUUID(),
    round_id: 'round-1',
    kind: 'BET',
    money_amount: '25.00',
    money_currency: 'BRL',
    status: 'PROCESSED',
  };
  const row = { ...base, ...overrides };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  await dataSource().query(
    `INSERT INTO wager_transactions (id, ${columns.join(', ')}, created_at)
     VALUES (gen_random_uuid(), ${placeholders.join(', ')}, now())`,
    Object.values(row),
  );
}

describeIfDocker('migration de wager_transactions — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
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

  it('cria a tabela wager_transactions', async () => {
    const rows = await dataSource().query(
      `SELECT to_regclass('public.wager_transactions') AS exists_check`,
    );
    expect((rows as { exists_check: string | null }[])[0]?.exists_check).toBe(
      'wager_transactions',
    );
  });

  it('exige wallet_id existente via FK', async () => {
    await expect(insertTransaction({ wallet_id: crypto.randomUUID() })).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('rejeita money_amount zero ou negativo', async () => {
    const walletId = await insertWallet();

    await expect(
      insertTransaction({ wallet_id: walletId, money_amount: '0.00' }),
    ).rejects.toThrow(/ck_tx_money_positive|violates check constraint/);
    await expect(
      insertTransaction({ wallet_id: walletId, money_amount: '-5.00' }),
    ).rejects.toThrow(/ck_tx_money_positive|violates check constraint/);
  });

  it('rejeita NaN como money_amount', async () => {
    const walletId = await insertWallet();

    await expect(
      insertTransaction({ wallet_id: walletId, money_amount: 'NaN' }),
    ).rejects.toThrow(/ck_tx_money_positive|violates check constraint/);
  });

  it('rejeita idempotency_key duplicada para o mesmo provider', async () => {
    const walletId = await insertWallet();
    const idempotencyKey = crypto.randomUUID();

    await insertTransaction({ wallet_id: walletId, idempotency_key: idempotencyKey });

    await expect(
      insertTransaction({ wallet_id: walletId, idempotency_key: idempotencyKey }),
    ).rejects.toThrow(/uq_tx_provider_idempotency|duplicate key/);
  });

  it('rejeita external_transaction_id duplicado para o mesmo provider', async () => {
    const walletId = await insertWallet();
    const externalTransactionId = crypto.randomUUID();

    await insertTransaction({ wallet_id: walletId, external_transaction_id: externalTransactionId });

    await expect(
      insertTransaction({
        wallet_id: walletId,
        external_transaction_id: externalTransactionId,
      }),
    ).rejects.toThrow(/uq_tx_provider_external|duplicate key/);
  });

  it('rejeita REFUND e ROLLBACK sem reference_external_transaction_id', async () => {
    const walletId = await insertWallet();

    await expect(
      insertTransaction({ wallet_id: walletId, kind: 'REFUND' }),
    ).rejects.toThrow(/ck_tx_reference_required|violates check constraint/);
    await expect(
      insertTransaction({ wallet_id: walletId, kind: 'ROLLBACK' }),
    ).rejects.toThrow(/ck_tx_reference_required|violates check constraint/);
  });

  it('aceita BET sem referencia', async () => {
    const walletId = await insertWallet();

    await insertTransaction({ wallet_id: walletId, kind: 'BET' });
  });

  it('rejeita status REJECTED ou FAILED sem failure_code', async () => {
    const walletId = await insertWallet();

    await expect(
      insertTransaction({ wallet_id: walletId, status: 'REJECTED' }),
    ).rejects.toThrow(/ck_tx_failure_code_on_terminal|violates check constraint/);
    await expect(
      insertTransaction({ wallet_id: walletId, status: 'FAILED' }),
    ).rejects.toThrow(/ck_tx_failure_code_on_terminal|violates check constraint/);
  });

  it('aceita REJECTED com failure_code presente', async () => {
    const walletId = await insertWallet();

    await insertTransaction({
      wallet_id: walletId,
      status: 'REJECTED',
      failure_code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('impede duas reversoes PROCESSED do mesmo tipo para a mesma referencia', async () => {
    const walletId = await insertWallet();
    const referenceRows = await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
       VALUES
         (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '25.00', 'BRL', 'PROCESSED', now())
       RETURNING id`,
      [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID()],
    );
    const referenceTransactionId = (referenceRows as { id: string }[])[0]!.id;

    await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, kind, money_amount, money_currency,
          reference_external_transaction_id, reference_transaction_id, status, created_at)
       VALUES
         (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'REFUND', '25.00', 'BRL',
          'ext-ref', $5, 'PROCESSED', now())`,
      [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID(), referenceTransactionId],
    );

    await expect(
      dataSource().query(
        `INSERT INTO wager_transactions
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
            wallet_id, player_id, round_id, kind, money_amount, money_currency,
            reference_external_transaction_id, reference_transaction_id, status, created_at)
         VALUES
           (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'REFUND', '25.00', 'BRL',
            'ext-ref', $5, 'PROCESSED', now())`,
        [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID(), referenceTransactionId],
      ),
    ).rejects.toThrow(/uq_reversal_per_reference|duplicate key/);
  });

  it('permite uma segunda tentativa REJECTED para a mesma referencia apos a primeira ja ter sido PROCESSED', async () => {
    const walletId = await insertWallet();
    const referenceRows = await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
       VALUES
         (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '25.00', 'BRL', 'PROCESSED', now())
       RETURNING id`,
      [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID()],
    );
    const referenceTransactionId = (referenceRows as { id: string }[])[0]!.id;

    await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, kind, money_amount, money_currency,
          reference_external_transaction_id, reference_transaction_id, status, created_at)
       VALUES
         (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'ROLLBACK', '25.00', 'BRL',
          'ext-ref-2', $5, 'PROCESSED', now())`,
      [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID(), referenceTransactionId],
    );

    await expect(
      dataSource().query(
        `INSERT INTO wager_transactions
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
            wallet_id, player_id, round_id, kind, money_amount, money_currency,
            reference_external_transaction_id, reference_transaction_id, status, failure_code, created_at)
         VALUES
           (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'ROLLBACK', '25.00', 'BRL',
            'ext-ref-2', $5, 'REJECTED', 'REFERENCE_ALREADY_REVERSED', now())`,
        [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID(), referenceTransactionId],
      ),
    ).resolves.toBeDefined();
  });

  it('rejeita REFUND/ROLLBACK PROCESSED sem reference_transaction_id resolvido', async () => {
    const walletId = await insertWallet();

    await expect(
      dataSource().query(
        `INSERT INTO wager_transactions
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
            wallet_id, player_id, round_id, kind, money_amount, money_currency,
            reference_external_transaction_id, status, created_at)
         VALUES
           (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'REFUND', '25.00', 'BRL',
            'ext-ref-sem-resolucao', 'PROCESSED', now())`,
        [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID()],
      ),
    ).rejects.toThrow(/ck_tx_reference_resolved_on_processed_reversal|violates check constraint/);
  });

  it('reverte removendo a tabela', async () => {
    async function tableExists(): Promise<boolean> {
      const rows = await dataSource().query(
        `SELECT to_regclass('public.wager_transactions') AS exists_check`,
      );
      return (rows as { exists_check: string | null }[])[0]?.exists_check !== null;
    }

    while (await tableExists()) {
      await dataSource().undoLastMigration();
    }

    expect(await tableExists()).toBe(false);

    await dataSource().runMigrations();
  });
});
