import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import { ExternalTransactionConflictError } from '@application/errors/external-transaction-conflict-error.ts';
import { IdempotencyKeyConflictError } from '@application/errors/idempotency-key-conflict-error.ts';
import { ReferenceAlreadyReversedError } from '@domain/errors/reference-already-reversed-error.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { Money } from '@domain/money/money.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
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
let unitOfWork: UnitOfWork | undefined;
let repository: WagerTransactionRepository | undefined;

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

function repo(): WagerTransactionRepository {
  if (repository === undefined) {
    throw new Error('WagerTransactionRepository não inicializado — beforeAll falhou');
  }
  return repository;
}

async function insertWallet(): Promise<string> {
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 1000.00, 1, now(), now())
     RETURNING id`,
  );
  return (rows as { id: string }[])[0]!.id;
}

async function insertProcessedReversal(
  walletId: string,
  playerId: string,
  referenceTransactionId: string,
  kind: 'REFUND' | 'ROLLBACK',
): Promise<void> {
  await dataSource().query(
    `INSERT INTO wager_transactions
       (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, kind, money_amount, money_currency,
        reference_external_transaction_id, reference_transaction_id, status, created_at)
     VALUES (gen_random_uuid(), 'provider-a', $1, $2, 'hash', $3, $4, 'round-1', $5, '25.00', 'BRL',
             'ext-ref', $6, 'PROCESSED', now())`,
    [
      crypto.randomUUID(),
      crypto.randomUUID(),
      walletId,
      playerId,
      kind,
      referenceTransactionId,
    ],
  );
}

function buildBet(
  overrides: Partial<{
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    walletId: string;
    playerId: string;
  }> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: crypto.randomUUID(),
    providerId: overrides.providerId ?? 'provider-a',
    externalTransactionId: overrides.externalTransactionId ?? crypto.randomUUID(),
    idempotencyKey: overrides.idempotencyKey ?? crypto.randomUUID(),
    payloadHash: 'hash',
    walletId: overrides.walletId ?? crypto.randomUUID(),
    playerId: overrides.playerId ?? crypto.randomUUID(),
    roundId: 'round-1',
    kind: WagerTransactionKind.BET,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    createdAt: new Date(),
  });
}

describeIfDocker('TypeOrmWagerTransactionRepository — contra Postgres real', () => {
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
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
    repository = new TypeOrmWagerTransactionRepository();
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

  it('insere e recarrega uma transação com os mesmos dados', async () => {
    const walletId = await insertWallet();
    const transaction = buildBet({ walletId });

    await uow().run((ctx) => repo().insert(ctx, transaction, null));

    const found = await uow().run((ctx) => repo().findById(ctx, transaction.id));
    expect(found?.id).toBe(transaction.id);
    expect(found?.providerId).toBe(transaction.providerId);
    expect(found?.status()).toBe(WagerTransactionStatus.PENDING);
    expect(found?.money.toJSON().amount).toBe('10.00');
  });

  it('retorna undefined para um id inexistente', async () => {
    const found = await uow().run((ctx) => repo().findById(ctx, crypto.randomUUID()));
    expect(found).toBeUndefined();
  });

  it('encontra por providerId e idempotencyKey', async () => {
    const walletId = await insertWallet();
    const transaction = buildBet({ walletId, providerId: 'provider-b' });
    await uow().run((ctx) => repo().insert(ctx, transaction, null));

    const found = await uow().run((ctx) =>
      repo().findByProviderAndIdempotencyKey(ctx, 'provider-b', transaction.idempotencyKey),
    );
    expect(found?.id).toBe(transaction.id);

    const notFound = await uow().run((ctx) =>
      repo().findByProviderAndIdempotencyKey(ctx, 'provider-b', crypto.randomUUID()),
    );
    expect(notFound).toBeUndefined();
  });

  it('encontra por providerId e externalTransactionId', async () => {
    const walletId = await insertWallet();
    const transaction = buildBet({ walletId, providerId: 'provider-c' });
    await uow().run((ctx) => repo().insert(ctx, transaction, null));

    const found = await uow().run((ctx) =>
      repo().findByProviderAndExternalTransactionId(
        ctx,
        'provider-c',
        transaction.externalTransactionId,
      ),
    );
    expect(found?.id).toBe(transaction.id);
  });

  it('persiste transição de estado feita por update', async () => {
    const walletId = await insertWallet();
    const transaction = buildBet({ walletId });
    await uow().run((ctx) => repo().insert(ctx, transaction, null));

    const at = new Date();
    transaction.markProcessed(undefined, at);
    await uow().run((ctx) => repo().update(ctx, transaction));

    const found = await uow().run((ctx) => repo().findById(ctx, transaction.id));
    expect(found?.status()).toBe(WagerTransactionStatus.PROCESSED);
    expect(found?.processedAt()?.getTime()).toBe(at.getTime());
  });

  it('persiste rejeição com failureCode', async () => {
    const walletId = await insertWallet();
    const transaction = buildBet({ walletId });
    await uow().run((ctx) => repo().insert(ctx, transaction, null));

    transaction.reject(FailureCode.INSUFFICIENT_FUNDS);
    await uow().run((ctx) => repo().update(ctx, transaction));

    const found = await uow().run((ctx) => repo().findById(ctx, transaction.id));
    expect(found?.status()).toBe(WagerTransactionStatus.REJECTED);
    expect(found?.failureCode()).toBe(FailureCode.INSUFFICIENT_FUNDS);
  });

  it('traduz 23505 de uq_tx_provider_idempotency em IdempotencyKeyConflictError', async () => {
    const walletId = await insertWallet();
    const idempotencyKey = crypto.randomUUID();
    const first = buildBet({ walletId, providerId: 'provider-d', idempotencyKey });
    await uow().run((ctx) => repo().insert(ctx, first, null));

    const second = buildBet({ walletId, providerId: 'provider-d', idempotencyKey });

    await expect(uow().run((ctx) => repo().insert(ctx, second, null))).rejects.toThrow(
      IdempotencyKeyConflictError,
    );
  });

  it('traduz 23505 de uq_tx_provider_external em ExternalTransactionConflictError', async () => {
    const walletId = await insertWallet();
    const externalTransactionId = crypto.randomUUID();
    const first = buildBet({ walletId, providerId: 'provider-e', externalTransactionId });
    await uow().run((ctx) => repo().insert(ctx, first, null));

    const second = buildBet({ walletId, providerId: 'provider-e', externalTransactionId });

    await expect(uow().run((ctx) => repo().insert(ctx, second, null))).rejects.toThrow(
      ExternalTransactionConflictError,
    );
  });

  it('traduz 23505 de uq_reversal_per_reference em ReferenceAlreadyReversedError', async () => {
    const walletId = await insertWallet();
    const playerId = crypto.randomUUID();
    const referenceRows = await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
       VALUES (gen_random_uuid(), 'provider-f', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '25.00', 'BRL', 'PROCESSED', now())
       RETURNING id`,
      [crypto.randomUUID(), crypto.randomUUID(), walletId, playerId],
    );
    const referenceTransactionId = (referenceRows as { id: string }[])[0]!.id;

    await insertProcessedReversal(walletId, playerId, referenceTransactionId, 'REFUND');

    const secondRefund = WagerTransaction.rehydrate({
      id: crypto.randomUUID(),
      providerId: 'provider-f',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'hash',
      walletId,
      playerId,
      roundId: 'round-1',
      kind: WagerTransactionKind.REFUND,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-ref',
      referenceTransactionId,
      status: WagerTransactionStatus.PROCESSED,
      processedAt: new Date(),
      createdAt: new Date(),
    });

    await expect(uow().run((ctx) => repo().insert(ctx, secondRefund, null))).rejects.toThrow(
      ReferenceAlreadyReversedError,
    );
  });

  it('traduz 23505 de uq_reversal_per_reference no caminho normal PENDING → PROCESSED via update', async () => {
    const walletId = await insertWallet();
    const playerId = crypto.randomUUID();
    const referenceRows = await dataSource().query(
      `INSERT INTO wager_transactions
         (id, provider_id, external_transaction_id, idempotency_key, payload_hash,
          wallet_id, player_id, round_id, kind, money_amount, money_currency, status, created_at)
       VALUES (gen_random_uuid(), 'provider-g', $1, $2, 'hash', $3, $4, 'round-1', 'BET', '25.00', 'BRL', 'PROCESSED', now())
       RETURNING id`,
      [crypto.randomUUID(), crypto.randomUUID(), walletId, playerId],
    );
    const referenceTransactionId = (referenceRows as { id: string }[])[0]!.id;

    const firstRefund = WagerTransaction.create({
      id: crypto.randomUUID(),
      providerId: 'provider-g',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'hash',
      walletId,
      playerId,
      roundId: 'round-1',
      kind: WagerTransactionKind.REFUND,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-ref-g',
      createdAt: new Date(),
    });
    const secondRefund = WagerTransaction.create({
      id: crypto.randomUUID(),
      providerId: 'provider-g',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'hash',
      walletId,
      playerId,
      roundId: 'round-1',
      kind: WagerTransactionKind.REFUND,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-ref-g',
      createdAt: new Date(),
    });

    await uow().run((ctx) => repo().insert(ctx, firstRefund, null));
    await uow().run((ctx) => repo().insert(ctx, secondRefund, null));

    firstRefund.markProcessed(referenceTransactionId, new Date());
    await uow().run((ctx) => repo().update(ctx, firstRefund));

    secondRefund.markProcessed(referenceTransactionId, new Date());
    await expect(uow().run((ctx) => repo().update(ctx, secondRefund))).rejects.toThrow(
      ReferenceAlreadyReversedError,
    );
  });
});
