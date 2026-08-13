import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { ListWalletLedgerUseCase } from '@application/use-cases/list-wallet-ledger-use-case.ts';

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
let useCase: ListWalletLedgerUseCase | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function listLedger(): ListWalletLedgerUseCase {
  if (useCase === undefined) {
    throw new Error('ListWalletLedgerUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
}

describeIfDocker('ListWalletLedgerUseCase — contra Postgres real', () => {
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
    const { ListWalletLedgerUseCase } = await import(
      '@application/use-cases/list-wallet-ledger-use-case.ts'
    );

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    useCase = new ListWalletLedgerUseCase(
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

  async function insertWalletWithEntries(count: number): Promise<string> {
    const playerId = crypto.randomUUID();
    const walletRows = await dataSource().query(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'BRL', '1000.00', 1, now(), now())
       RETURNING id`,
      [playerId],
    );
    const walletId = (walletRows as { id: string }[])[0]!.id;

    for (let i = 0; i < count; i++) {
      const txRows = await dataSource().query(
        `INSERT INTO wager_transactions
           (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
            wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
         VALUES (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '1.00', 'BRL', 'PROCESSED',
                 now() + ($5 || ' milliseconds')::interval)
         RETURNING id`,
        [crypto.randomUUID(), crypto.randomUUID(), walletId, playerId, i * 10],
      );
      const transactionId = (txRows as { id: string }[])[0]!.id;

      await dataSource().query(
        `INSERT INTO wallet_ledger_entries
           (id, wallet_id, transaction_id, direction, money_amount, balance_before_amount, balance_after_amount, currency, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'DEBIT', '1.00', '1.00', '0.00', 'BRL',
                 now() + ($3 || ' milliseconds')::interval)`,
        [walletId, transactionId, i * 10],
      );
    }

    return walletId;
  }

  it('retorna todas as páginas em ordem decrescente sem repetir nem pular entradas', async () => {
    const walletId = await insertWalletWithEntries(7);

    const collected: string[] = [];
    let cursor: string | undefined;
    let guard = 0;

    do {
      const page = await listLedger().execute({
        walletId,
        limit: 3,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      collected.push(...page.entries.map((e) => e.id));
      cursor = page.nextCursor;
      guard += 1;
      if (guard > 10) {
        throw new Error('paginação não convergiu — possível loop infinito');
      }
    } while (cursor !== undefined);

    expect(collected).toHaveLength(7);
    expect(new Set(collected).size).toBe(7);

    const directRows = await dataSource().query(
      `SELECT id FROM wallet_ledger_entries WHERE wallet_id = $1 ORDER BY created_at DESC, id DESC`,
      [walletId],
    );
    expect(collected).toEqual((directRows as { id: string }[]).map((r) => r.id));
  });

  it('hasMore é false na última página', async () => {
    const walletId = await insertWalletWithEntries(2);

    const page = await listLedger().execute({ walletId, limit: 50 });

    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });
});
