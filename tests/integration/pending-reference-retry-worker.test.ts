import { afterAll, beforeAll, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import type { PendingReferenceRetryWorker } from '@workers/pending-reference/pending-reference-retry-worker.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advanceMs(deltaMs: number): void {
    this.current = new Date(this.current.getTime() + deltaMs);
  }
}

class DeclaredIdentity implements ProviderIdentityPort {
  resolveProviderId(declared: string): string {
    return declared;
  }
}

let AppDataSource: DataSource | undefined;
let useCase: ProcessWagerTransactionUseCase | undefined;
let clock: MutableClock | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function processWager(): ProcessWagerTransactionUseCase {
  if (useCase === undefined) {
    throw new Error('ProcessWagerTransactionUseCase não inicializado — beforeAll falhou');
  }
  return useCase;
}

function testClock(): MutableClock {
  if (clock === undefined) {
    throw new Error('Clock não inicializado — beforeAll falhou');
  }
  return clock;
}

async function insertWallet(balance: string): Promise<{ id: string; playerId: string }> {
  const playerId = crypto.randomUUID();
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'BRL', $2, 1, now(), now())
     RETURNING id`,
    [playerId, balance],
  );
  return { id: (rows as { id: string }[])[0]!.id, playerId };
}

async function buildWorker(
  policyOverrides: Partial<{ maxAttempts: number; ttlHours: number }> = {},
): Promise<PendingReferenceRetryWorker> {
  const { TypeOrmUnitOfWork } = await import(
    '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
  );
  const { TypeOrmWagerTransactionRepository } = await import(
    '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
  );
  const { PendingReferenceRetryWorker: WorkerClass } = await import(
    '@workers/pending-reference/pending-reference-retry-worker.ts'
  );

  return new WorkerClass({
    unitOfWork: new TypeOrmUnitOfWork(dataSource()),
    wagerTransactionRepository: new TypeOrmWagerTransactionRepository(),
    useCase: processWager(),
    clock: testClock(),
    batchSize: 10,
    retryPolicy: { maxAttempts: 8, ttlHours: 24, ...policyOverrides },
  });
}

describeIfDocker('PendingReferenceRetryWorker — contra Postgres real', () => {
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
    const { ProcessWagerTransactionUseCase } = await import(
      '@application/use-cases/process-wager-transaction-use-case.ts'
    );

    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    clock = new MutableClock(new Date('2026-01-01T00:00:00.000Z'));
    useCase = new ProcessWagerTransactionUseCase(
      new TypeOrmUnitOfWork(AppDataSource),
      new TypeOrmWalletRepository(clock),
      new TypeOrmWagerTransactionRepository(),
      new TypeOrmLedgerRepository(),
      new TypeOrmOutboxRepository(),
      new DeclaredIdentity(),
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

  it('reprocessa e conclui quando a referência aparece depois da retenção', async () => {
    const wallet = await insertWallet('75.00');
    const betExternalId = crypto.randomUUID();

    const refundResult = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: betExternalId,
    });
    expect(refundResult.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

    const worker = await buildWorker();
    const processedBeforeBet = await worker.runOnce();
    expect(processedBeforeBet).toBe(1);

    const stillPendingRows = await dataSource().query(
      `SELECT status, pending_reference_attempts FROM wager_transactions WHERE id = $1`,
      [refundResult.transactionId],
    );
    expect((stillPendingRows as { status: string; pending_reference_attempts: number }[])[0]).toEqual({
      status: 'PENDING_REFERENCE',
      pending_reference_attempts: 1,
    });

    const betResult = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: { amount: '25.00', currency: 'BRL' },
    });
    expect(betResult.status).toBe(WagerTransactionStatus.PROCESSED);

    testClock().advanceMs(3_000);
    const processedAfterBet = await worker.runOnce();
    expect(processedAfterBet).toBe(1);

    const finalRows = await dataSource().query(
      `SELECT status FROM wager_transactions WHERE id = $1`,
      [refundResult.transactionId],
    );
    expect((finalRows as { status: string }[])[0]?.status).toBe('PROCESSED');

    const walletRows = await dataSource().query(`SELECT balance_amount FROM wallets WHERE id = $1`, [
      wallet.id,
    ]);
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('75.00');

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1 ORDER BY occurred_at`,
      [refundResult.transactionId],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionProcessed',
    ]);
  });

  it('expira para REJECTED/REFERENCE_NOT_FOUND após esgotar as tentativas', async () => {
    const wallet = await insertWallet('100.00');

    const refundResult = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: crypto.randomUUID(),
    });
    expect(refundResult.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

    const worker = await buildWorker({ maxAttempts: 2, ttlHours: 24 });

    await worker.runOnce();
    testClock().advanceMs(3_000);
    await worker.runOnce();
    testClock().advanceMs(5_000);
    const processedOnExpiry = await worker.runOnce();
    expect(processedOnExpiry).toBe(1);

    const finalRows = await dataSource().query(
      `SELECT status, failure_code FROM wager_transactions WHERE id = $1`,
      [refundResult.transactionId],
    );
    expect((finalRows as { status: string; failure_code: string }[])[0]).toEqual({
      status: 'REJECTED',
      failure_code: FailureCode.REFERENCE_NOT_FOUND,
    });

    const walletRows = await dataSource().query(`SELECT balance_amount FROM wallets WHERE id = $1`, [
      wallet.id,
    ]);
    expect((walletRows as { balance_amount: string }[])[0]?.balance_amount).toBe('100.00');

    const outboxRows = await dataSource().query(
      `SELECT event_type FROM outbox_messages WHERE aggregate_id = $1 ORDER BY occurred_at`,
      [refundResult.transactionId],
    );
    expect((outboxRows as { event_type: string }[]).map((r) => r.event_type)).toEqual([
      'WagerTransactionPendingReference',
      'WagerTransactionRejected',
    ]);
  });

  it('expira para REJECTED/REFERENCE_NOT_FOUND quando o TTL vence, mesmo com poucas tentativas', async () => {
    const wallet = await insertWallet('50.00');

    const refundResult = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: crypto.randomUUID(),
    });
    expect(refundResult.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

    const worker = await buildWorker({ maxAttempts: 8, ttlHours: 0 });

    const processed = await worker.runOnce();
    expect(processed).toBe(1);

    const finalRows = await dataSource().query(
      `SELECT status, failure_code, pending_reference_attempts FROM wager_transactions WHERE id = $1`,
      [refundResult.transactionId],
    );
    expect(
      (finalRows as { status: string; failure_code: string; pending_reference_attempts: number }[])[0],
    ).toEqual({
      status: 'REJECTED',
      failure_code: FailureCode.REFERENCE_NOT_FOUND,
      pending_reference_attempts: 0,
    });
  });

  it('SKIP LOCKED permite que dois workers concorrentes reivindiquem transações distintas sem duplicar efeito', async () => {
    const walletA = await insertWallet('100.00');
    const walletB = await insertWallet('100.00');

    const refundA = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: walletA.playerId,
      walletId: walletA.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '10.00', currency: 'BRL' },
      referenceExternalTransactionId: crypto.randomUUID(),
    });
    const refundB = await processWager().execute({
      declaredProviderId: 'provider-a',
      idempotencyKey: crypto.randomUUID(),
      externalTransactionId: crypto.randomUUID(),
      playerId: walletB.playerId,
      walletId: walletB.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.REFUND,
      money: { amount: '10.00', currency: 'BRL' },
      referenceExternalTransactionId: crypto.randomUUID(),
    });

    const workerOne = await buildWorker();
    const workerTwo = await buildWorker();

    const [processedOne, processedTwo] = await Promise.all([
      workerOne.runOnce(),
      workerTwo.runOnce(),
    ]);

    expect(processedOne + processedTwo).toBe(2);

    const rows = await dataSource().query(
      `SELECT id, pending_reference_attempts FROM wager_transactions WHERE id = ANY($1::uuid[])`,
      [[refundA.transactionId, refundB.transactionId]],
    );
    for (const row of rows as { id: string; pending_reference_attempts: number }[]) {
      expect(row.pending_reference_attempts).toBe(1);
    }
  });
});
