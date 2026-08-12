import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';

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

async function insertTransaction(walletId: string): Promise<string> {
  const rows = await dataSource().query(
    `INSERT INTO wager_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
     VALUES
       (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '25.00', 'BRL', 'PROCESSED', now())
     RETURNING id`,
    [crypto.randomUUID(), crypto.randomUUID(), walletId, crypto.randomUUID()],
  );
  return (rows as { id: string }[])[0]!.id;
}

interface EntryOverrides {
  readonly direction?: string;
  readonly money_amount?: string;
  readonly balance_before_amount?: string;
  readonly balance_after_amount?: string;
}

async function insertEntry(
  walletId: string,
  transactionId: string,
  overrides: EntryOverrides = {},
): Promise<void> {
  const row = {
    direction: 'DEBIT',
    money_amount: '25.00',
    balance_before_amount: '100.00',
    balance_after_amount: '75.00',
    ...overrides,
  };
  await dataSource().query(
    `INSERT INTO wallet_ledger_entries
       (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount,
        balance_after_amount, currency, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'BRL', now())`,
    [
      walletId,
      transactionId,
      row.direction,
      row.money_amount,
      row.balance_before_amount,
      row.balance_after_amount,
    ],
  );
}

describeIfDocker('migration de wallet_ledger_entries — contra Postgres real', () => {
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

  it('cria a tabela wallet_ledger_entries', async () => {
    const rows = await dataSource().query(
      `SELECT to_regclass('public.wallet_ledger_entries') AS exists_check`,
    );
    expect((rows as { exists_check: string | null }[])[0]?.exists_check).toBe(
      'wallet_ledger_entries',
    );
  });

  it('CREDIT correto e aceito', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await insertEntry(walletId, transactionId, {
      direction: 'CREDIT',
      balance_before_amount: '100.00',
      balance_after_amount: '125.00',
    });
  });

  it('DEBIT correto e aceito', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await insertEntry(walletId, transactionId, {
      direction: 'DEBIT',
      balance_before_amount: '100.00',
      balance_after_amount: '75.00',
    });
  });

  it('rejeita CREDIT cuja aritmetica nao fecha', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await expect(
      insertEntry(walletId, transactionId, {
        direction: 'CREDIT',
        balance_before_amount: '100.00',
        balance_after_amount: '999.00',
      }),
    ).rejects.toThrow(/ck_ledger_arithmetic|violates check constraint/);
  });

  it('rejeita DEBIT cuja aritmetica nao fecha', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await expect(
      insertEntry(walletId, transactionId, {
        direction: 'DEBIT',
        balance_before_amount: '100.00',
        balance_after_amount: '999.00',
      }),
    ).rejects.toThrow(/ck_ledger_arithmetic|violates check constraint/);
  });

  it('rejeita money_amount zero, negativo ou NaN', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await expect(
      insertEntry(walletId, transactionId, { money_amount: '0.00' }),
    ).rejects.toThrow(/ck_ledger_money_positive|violates check constraint/);
    await expect(
      insertEntry(walletId, transactionId, { money_amount: '-5.00' }),
    ).rejects.toThrow(/ck_ledger_money_positive|violates check constraint/);
    await expect(
      insertEntry(walletId, transactionId, { money_amount: 'NaN' }),
    ).rejects.toThrow(/ck_ledger_money_positive|violates check constraint/);
  });

  it('rejeita saldos negativos ou NaN', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await expect(
      insertEntry(walletId, transactionId, {
        balance_before_amount: '-10.00',
        balance_after_amount: '15.00',
      }),
    ).rejects.toThrow(/ck_ledger_balance_non_negative|violates check constraint/);
    await expect(
      insertEntry(walletId, transactionId, {
        balance_before_amount: 'NaN',
        balance_after_amount: '25.00',
      }),
    ).rejects.toThrow(/ck_ledger_balance_non_negative|violates check constraint/);
  });

  it('rejeita dois lancamentos para a mesma transacao e wallet', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await insertEntry(walletId, transactionId);

    await expect(insertEntry(walletId, transactionId)).rejects.toThrow(
      /uq_ledger_tx_wallet|duplicate key/,
    );
  });

  it('exige wallet_id e transaction_id existentes via FK', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);

    await expect(insertEntry(crypto.randomUUID(), transactionId)).rejects.toThrow(
      /violates foreign key constraint/,
    );
    await expect(insertEntry(walletId, crypto.randomUUID())).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('rejeita lancamento cujo wallet_id diverge do wallet_id real da transacao', async () => {
    const walletA = await insertWallet();
    const walletB = await insertWallet();
    const transactionOfA = await insertTransaction(walletA);

    await expect(insertEntry(walletB, transactionOfA)).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('RULE bloqueia UPDATE — a linha permanece identica', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);
    await insertEntry(walletId, transactionId);

    await dataSource().query(
      `UPDATE wallet_ledger_entries SET money_amount = '999.00' WHERE transaction_id = $1`,
      [transactionId],
    );

    const rows = await dataSource().query(
      `SELECT money_amount FROM wallet_ledger_entries WHERE transaction_id = $1`,
      [transactionId],
    );
    expect((rows as { money_amount: string }[])[0]?.money_amount).toBe('25.00');
  });

  it('RULE bloqueia DELETE — a linha continua existindo', async () => {
    const walletId = await insertWallet();
    const transactionId = await insertTransaction(walletId);
    await insertEntry(walletId, transactionId);

    await dataSource().query(`DELETE FROM wallet_ledger_entries WHERE transaction_id = $1`, [
      transactionId,
    ]);

    const rows = await dataSource().query(
      `SELECT 1 AS found FROM wallet_ledger_entries WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(rows).toHaveLength(1);
  });

  it('cria o indice de cursor por wallet', async () => {
    const rows = await dataSource().query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'wallet_ledger_entries' AND indexname = 'ix_ledger_wallet_cursor'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('reverte removendo a tabela', async () => {
    async function tableExists(): Promise<boolean> {
      const rows = await dataSource().query(
        `SELECT to_regclass('public.wallet_ledger_entries') AS exists_check`,
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
