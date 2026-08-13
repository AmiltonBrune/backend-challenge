import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import { WalletAlreadyExistsError } from '@application/errors/wallet-already-exists-error.ts';
import type { OpenWalletUseCase } from '@application/use-cases/open-wallet-use-case.ts';

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

let AppDataSource: DataSource | undefined;
let useCase: OpenWalletUseCase | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function openWallet(): OpenWalletUseCase {
  if (useCase === undefined) {
    throw new Error('OpenWalletUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
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

describeIfDocker('OpenWalletUseCase — contra Postgres real', () => {
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
    const { TypeOrmWagerTransactionRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
    );
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );
    const { UuidIdGenerator } = await import('@infrastructure/uuid-id-generator.ts');
    const { OpenWalletUseCase } = await import(
      '@application/use-cases/open-wallet-use-case.ts'
    );

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const clock = new FixedClock();
    useCase = new OpenWalletUseCase(
      new TypeOrmUnitOfWork(AppDataSource),
      new TypeOrmWalletRepository(clock),
      new TypeOrmWagerTransactionRepository(),
      new TypeOrmLedgerRepository(),
      new TypeOrmOutboxRepository(),
      clock,
      new UuidIdGenerator(),
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

  it('persiste wallet, transação OPENING, lançamento e dois eventos atomicamente', async () => {
    const result = await openWallet().execute({
      playerId: crypto.randomUUID(),
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    const walletRows = await dataSource().query(
      `SELECT balance_amount, version FROM wallets WHERE id = $1`,
      [result.wallet.id],
    );
    expect(walletRows).toHaveLength(1);
    expect((walletRows as { balance_amount: string; version: number }[])[0]).toEqual({
      balance_amount: '1000.00',
      version: 1,
    });

    const txRows = await dataSource().query(
      `SELECT kind, status FROM wager_transactions WHERE wallet_id = $1`,
      [result.wallet.id],
    );
    expect(txRows).toHaveLength(1);
    expect((txRows as { kind: string; status: string }[])[0]).toEqual({
      kind: 'OPENING',
      status: 'PROCESSED',
    });

    const ledgerRows = await dataSource().query(
      `SELECT direction, money_amount, balance_before_amount, balance_after_amount
       FROM wallet_ledger_entries WHERE wallet_id = $1`,
      [result.wallet.id],
    );
    expect(ledgerRows).toHaveLength(1);
    expect(
      (
        ledgerRows as {
          direction: string;
          money_amount: string;
          balance_before_amount: string;
          balance_after_amount: string;
        }[]
      )[0],
    ).toEqual({
      direction: 'CREDIT',
      money_amount: '1000.00',
      balance_before_amount: '0.00',
      balance_after_amount: '1000.00',
    });

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1 ORDER BY occurred_at`,
      [result.wallet.id],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WalletOpened',
      'WalletBalanceChanged',
    ]);
  });

  it('persiste apenas wallet e um evento quando o saldo inicial é zero', async () => {
    const result = await openWallet().execute({
      playerId: crypto.randomUUID(),
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    const txRows = await dataSource().query(
      `SELECT 1 FROM wager_transactions WHERE wallet_id = $1`,
      [result.wallet.id],
    );
    expect(txRows).toHaveLength(0);

    const ledgerRows = await dataSource().query(
      `SELECT 1 FROM wallet_ledger_entries WHERE wallet_id = $1`,
      [result.wallet.id],
    );
    expect(ledgerRows).toHaveLength(0);

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1`,
      [result.wallet.id],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WalletOpened',
    ]);
  });

  it('recusa abertura duplicada por conflito e não deixa nenhum efeito colateral', async () => {
    const playerId = crypto.randomUUID();
    await openWallet().execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const before = await countAllTables();

    await expect(
      openWallet().execute({
        playerId,
        initialBalance: { amount: '500.00', currency: 'BRL' },
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);

    const after = await countAllTables();
    expect(after).toEqual(before);

    const wallets = await dataSource().query(
      `SELECT balance_amount FROM wallets WHERE player_id = $1`,
      [playerId],
    );
    expect(wallets).toHaveLength(1);
    expect((wallets as { balance_amount: string }[])[0]?.balance_amount).toBe('100.00');
  });
});
