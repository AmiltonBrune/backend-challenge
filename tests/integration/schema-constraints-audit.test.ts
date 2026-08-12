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

async function hasConstraint(table: string, name: string): Promise<boolean> {
  const rows = await dataSource().query(
    `SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`,
    [table, name],
  );
  return (rows as unknown[]).length > 0;
}

async function hasForeignKeyTo(table: string, referencedTable: string): Promise<boolean> {
  const rows = await dataSource().query(
    `SELECT 1 FROM pg_constraint
     WHERE conrelid = $1::regclass AND contype = 'f' AND confrelid = $2::regclass`,
    [table, referencedTable],
  );
  return (rows as unknown[]).length > 0;
}

async function hasRule(table: string, name: string): Promise<boolean> {
  const rows = await dataSource().query(
    `SELECT 1 FROM pg_rules WHERE tablename = $1 AND rulename = $2`,
    [table, name],
  );
  return (rows as unknown[]).length > 0;
}

async function hasIndex(table: string, name: string): Promise<boolean> {
  const rows = await dataSource().query(
    `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
    [table, name],
  );
  return (rows as unknown[]).length > 0;
}

async function insertWallet(): Promise<string> {
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 1000.00, 1, now(), now())
     RETURNING id`,
  );
  return (rows as { id: string }[])[0]!.id;
}

async function insertTransaction(walletId: string, overrides: Record<string, unknown> = {}): Promise<string> {
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
  const placeholders = columns.map((_, i) => `$${i + 2}`);
  const rows = await dataSource().query(
    `INSERT INTO wager_transactions (id, wallet_id, ${columns.join(', ')}, created_at)
     VALUES (gen_random_uuid(), $1, ${placeholders.join(', ')}, now())
     RETURNING id`,
    [walletId, ...Object.values(row)],
  );
  return (rows as { id: string }[])[0]!.id;
}

describeIfDocker('T-024 — auditoria de constraints do schema completo', () => {
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

  describe('wallets', () => {
    it('possui todas as constraints documentadas em ARCHITECTURE.md §8.1', async () => {
      expect(await hasConstraint('wallets', 'uq_wallet_player_currency')).toBe(true);
      expect(await hasConstraint('wallets', 'ck_wallet_balance_non_negative')).toBe(true);
      expect(await hasConstraint('wallets', 'ck_wallet_version_positive')).toBe(true);
    });
  });

  describe('wager_transactions', () => {
    it('possui todas as constraints documentadas', async () => {
      expect(await hasConstraint('wager_transactions', 'uq_tx_provider_idempotency')).toBe(true);
      expect(await hasConstraint('wager_transactions', 'uq_tx_provider_external')).toBe(true);
      expect(await hasConstraint('wager_transactions', 'ck_tx_money_positive')).toBe(true);
      expect(await hasConstraint('wager_transactions', 'ck_tx_reference_required')).toBe(true);
      expect(await hasConstraint('wager_transactions', 'ck_tx_failure_code_on_terminal')).toBe(true);
      expect(
        await hasConstraint(
          'wager_transactions',
          'ck_tx_reference_resolved_on_processed_reversal',
        ),
      ).toBe(true);
      expect(await hasConstraint('wager_transactions', 'uq_tx_id_wallet')).toBe(true);
      expect(await hasIndex('wager_transactions', 'uq_reversal_per_reference')).toBe(true);
      expect(await hasForeignKeyTo('wager_transactions', 'wallets')).toBe(true);
      expect(await hasForeignKeyTo('wager_transactions', 'wager_transactions')).toBe(true);
    });

    it('uq_tx_id_wallet cobre exatamente as colunas (id, wallet_id) — nao e testavel por insercao duplicada, pois id ja e PK isolada', async () => {
      const rows = await dataSource().query(
        `SELECT a.attname
         FROM pg_constraint c
         JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'wager_transactions'::regclass AND c.conname = 'uq_tx_id_wallet'
         ORDER BY k.ord`,
      );
      const columns = (rows as { attname: string }[]).map((r) => r.attname);

      expect(columns).toEqual(['id', 'wallet_id']);
    });

    it('rejeita reference_transaction_id que aponta para uma transacao inexistente — FK, nao apenas o CHECK de resolucao', async () => {
      const walletId = await insertWallet();

      await expect(
        insertTransaction(walletId, {
          kind: 'REFUND',
          reference_external_transaction_id: 'ext-ref-1',
          reference_transaction_id: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('rejeita REFUND/ROLLBACK PROCESSED com reference_transaction_id ausente — CHECK, nao a FK', async () => {
      const walletId = await insertWallet();

      await expect(
        insertTransaction(walletId, {
          kind: 'REFUND',
          reference_external_transaction_id: 'ext-ref-1',
        }),
      ).rejects.toThrow(/ck_tx_reference_resolved_on_processed_reversal/);
    });
  });

  describe('wallet_ledger_entries', () => {
    it('possui todas as constraints documentadas', async () => {
      expect(await hasConstraint('wallet_ledger_entries', 'uq_ledger_tx_wallet')).toBe(true);
      expect(await hasConstraint('wallet_ledger_entries', 'ck_ledger_money_positive')).toBe(true);
      expect(
        await hasConstraint('wallet_ledger_entries', 'ck_ledger_balance_non_negative'),
      ).toBe(true);
      expect(await hasConstraint('wallet_ledger_entries', 'ck_ledger_arithmetic')).toBe(true);
      expect(await hasForeignKeyTo('wallet_ledger_entries', 'wallets')).toBe(true);
      expect(await hasForeignKeyTo('wallet_ledger_entries', 'wager_transactions')).toBe(true);
      expect(await hasRule('wallet_ledger_entries', 'ledger_no_update')).toBe(true);
      expect(await hasRule('wallet_ledger_entries', 'ledger_no_delete')).toBe(true);
      expect(await hasIndex('wallet_ledger_entries', 'ix_ledger_wallet_cursor')).toBe(true);
    });

    it('ck_ledger_balance_non_negative rejeita balance_after_amount negativo isoladamente', async () => {
      const walletId = await insertWallet();
      const transactionId = await insertTransaction(walletId);

      await expect(
        dataSource().query(
          `INSERT INTO wallet_ledger_entries
             (id, wallet_id, transaction_id, direction, money_amount,
              balance_before_amount, balance_after_amount, currency, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'DEBIT', '25.00', '10.00', '-15.00', 'BRL', now())`,
          [walletId, transactionId],
        ),
      ).rejects.toThrow(/ck_ledger_balance_non_negative/);
    });

    it('ck_ledger_balance_non_negative rejeita NaN isoladamente — mesmo quando NaN = NaN + money satisfaz a aritmetica', async () => {
      const walletId = await insertWallet();
      const transactionId = await insertTransaction(walletId);

      await expect(
        dataSource().query(
          `INSERT INTO wallet_ledger_entries
             (id, wallet_id, transaction_id, direction, money_amount,
              balance_before_amount, balance_after_amount, currency, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'CREDIT', '25.00', 'NaN', 'NaN', 'BRL', now())`,
          [walletId, transactionId],
        ),
      ).rejects.toThrow(/ck_ledger_balance_non_negative/);
    });
  });

  describe('inbox_messages', () => {
    it('possui a chave primaria composta documentada', async () => {
      expect(await hasConstraint('inbox_messages', 'pk_inbox')).toBe(true);
    });
  });

  describe('outbox_messages', () => {
    it('possui o indice parcial de pendentes documentado', async () => {
      expect(await hasIndex('outbox_messages', 'ix_outbox_pending')).toBe(true);
    });
  });

  describe('assertion final — saldo reconstruido do ledger', () => {
    it('wallet.balance == SUM(CREDIT) − SUM(DEBIT) apos uma sequencia de movimentos', async () => {
      const walletRows = await dataSource().query(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 0.00, 1, now(), now())
         RETURNING id`,
      );
      const walletId = (walletRows as { id: string }[])[0]!.id;

      const opening = await insertTransaction(walletId, {
        kind: 'OPENING',
        money_amount: '1000.00',
        status: 'PROCESSED',
      });
      await dataSource().query(
        `INSERT INTO wallet_ledger_entries
           (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount, balance_after_amount, currency, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'CREDIT', '1000.00', '0.00', '1000.00', 'BRL', now())`,
        [walletId, opening],
      );

      const bet1 = await insertTransaction(walletId, { money_amount: '80.00', status: 'PROCESSED' });
      await dataSource().query(
        `INSERT INTO wallet_ledger_entries
           (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount, balance_after_amount, currency, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'DEBIT', '80.00', '1000.00', '920.00', 'BRL', now())`,
        [walletId, bet1],
      );

      const win1 = await insertTransaction(walletId, {
        kind: 'WIN',
        money_amount: '30.00',
        status: 'PROCESSED',
      });
      await dataSource().query(
        `INSERT INTO wallet_ledger_entries
           (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount, balance_after_amount, currency, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'CREDIT', '30.00', '920.00', '950.00', 'BRL', now())`,
        [walletId, win1],
      );
      await dataSource().query(`UPDATE wallets SET balance_amount = '950.00', version = 3 WHERE id = $1`, [
        walletId,
      ]);

      const [walletRow] = await dataSource().query(
        `SELECT balance_amount FROM wallets WHERE id = $1`,
        [walletId],
      );
      const [ledgerSum] = await dataSource().query(
        `SELECT SUM(CASE direction WHEN 'CREDIT' THEN money_amount ELSE -money_amount END) AS total
         FROM wallet_ledger_entries WHERE wallet_id = $1`,
        [walletId],
      );

      expect(Number(walletRow.balance_amount)).toBe(Number(ledgerSum.total));
      expect(walletRow.balance_amount).toBe('950.00');
    });
  });
});
