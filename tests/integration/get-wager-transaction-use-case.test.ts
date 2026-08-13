import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { GetWagerTransactionUseCase } from '@application/use-cases/get-wager-transaction-use-case.ts';
import { WagerTransactionNotFoundError } from '@application/errors/wager-transaction-not-found-error.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';

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
let useCase: GetWagerTransactionUseCase | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function getTransaction(): GetWagerTransactionUseCase {
  if (useCase === undefined) {
    throw new Error('GetWagerTransactionUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
}

describeIfDocker('GetWagerTransactionUseCase — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmWagerTransactionRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
    );
    const { GetWagerTransactionUseCase } = await import(
      '@application/use-cases/get-wager-transaction-use-case.ts'
    );

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    useCase = new GetWagerTransactionUseCase(
      new TypeOrmUnitOfWork(AppDataSource),
      new TypeOrmWagerTransactionRepository(),
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

  async function insertWalletAndBet(): Promise<{
    transactionId: string;
    walletId: string;
    playerId: string;
    externalTransactionId: string;
  }> {
    const playerId = crypto.randomUUID();
    const walletRows = await dataSource().query(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'BRL', '100.00', 1, now(), now())
       RETURNING id`,
      [playerId],
    );
    const walletId = (walletRows as { id: string }[])[0]!.id;
    const externalTransactionId = crypto.randomUUID();

    const txRows = await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency, status, created_at, processed_at)
       VALUES (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', 'fortune-chimp', 'BET', '25.00', 'BRL', 'PROCESSED', now(), now())
       RETURNING id`,
      [externalTransactionId, crypto.randomUUID(), walletId, playerId],
    );
    const transactionId = (txRows as { id: string }[])[0]!.id;

    return { transactionId, walletId, playerId, externalTransactionId };
  }

  it('busca por transactionId, incluindo gameId real', async () => {
    const seeded = await insertWalletAndBet();

    const result = await getTransaction().execute({ transactionId: seeded.transactionId });

    expect(result.transactionId).toBe(seeded.transactionId);
    expect(result.gameId).toBe('fortune-chimp');
    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.money.amount).toBe('25.00');
  });

  it('busca por (providerId, externalTransactionId)', async () => {
    const seeded = await insertWalletAndBet();

    const result = await getTransaction().execute({
      providerId: 'provider-a',
      externalTransactionId: seeded.externalTransactionId,
    });

    expect(result.transactionId).toBe(seeded.transactionId);
  });

  it('lança WagerTransactionNotFoundError para um transactionId inexistente', async () => {
    await expect(
      getTransaction().execute({ transactionId: crypto.randomUUID() }),
    ).rejects.toThrow(WagerTransactionNotFoundError);
  });

  it('lança WagerTransactionNotFoundError quando o externalTransactionId pertence a outro provider', async () => {
    const seeded = await insertWalletAndBet();

    await expect(
      getTransaction().execute({
        providerId: 'provider-outro',
        externalTransactionId: seeded.externalTransactionId,
      }),
    ).rejects.toThrow(WagerTransactionNotFoundError);
  });
});
