import { describe, expect, it } from 'bun:test';
import type { Clock } from '@application/ports/clock.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type {
  PendingReferenceCandidate,
  WagerTransactionRepository,
} from '@application/ports/wager-transaction-repository.ts';
import type {
  PendingReferenceRetryPolicy,
  ProcessWagerTransactionResult,
} from '@application/use-cases/process-wager-transaction-use-case.ts';
import { Money } from '@domain/money/money.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { PendingReferenceRetryWorker } from '@workers/pending-reference/pending-reference-retry-worker.ts';

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

class PassthroughUnitOfWork implements UnitOfWork {
  runCount = 0;
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    this.runCount += 1;
    return work(undefined);
  }
}

function pendingRefund(id: string, overrides: Partial<{ attempts: number; nextAttemptAt: Date }> = {}) {
  return WagerTransaction.rehydrate({
    id,
    providerId: 'provider-a',
    externalTransactionId: `ext-${id}`,
    idempotencyKey: `idem-${id}`,
    payloadHash: 'hash',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    kind: WagerTransactionKind.REFUND,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    referenceExternalTransactionId: 'ext-bet-1',
    status: WagerTransactionStatus.PENDING_REFERENCE,
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pendingReferenceAttempts: overrides.attempts ?? 0,
    ...(overrides.nextAttemptAt !== undefined
      ? { pendingReferenceNextAttemptAt: overrides.nextAttemptAt }
      : {}),
  });
}

class FakeWagerTransactionRepository implements Pick<
  WagerTransactionRepository,
  'findEligiblePendingReferenceForRetry'
> {
  readonly store = new Map<string, { transaction: WagerTransaction; gameId: string | null }>();
  readonly calls: Array<{ now: Date; limit: number }> = [];

  seed(transaction: WagerTransaction, gameId: string | null = null): void {
    this.store.set(transaction.id, { transaction, gameId });
  }

  async findEligiblePendingReferenceForRetry(
    _ctx: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<PendingReferenceCandidate[]> {
    this.calls.push({ now, limit });
    return [...this.store.values()]
      .filter((candidate) => candidate.transaction.status() === WagerTransactionStatus.PENDING_REFERENCE)
      .filter((candidate) => {
        const nextAttemptAt = candidate.transaction.pendingReferenceNextAttemptAt();
        return nextAttemptAt === undefined || nextAttemptAt.getTime() <= now.getTime();
      })
      .slice(0, limit);
  }
}

class RecordingUseCase {
  readonly calls: Array<{
    transaction: WagerTransaction;
    gameId: string | null;
    policy: PendingReferenceRetryPolicy;
    now: Date;
  }> = [];

  constructor(private readonly resultFor: (transaction: WagerTransaction) => ProcessWagerTransactionResult) {}

  async retryPendingReference(
    _ctx: TransactionContext,
    transaction: WagerTransaction,
    gameId: string | null,
    policy: PendingReferenceRetryPolicy,
    now: Date,
  ): Promise<ProcessWagerTransactionResult> {
    this.calls.push({ transaction, gameId, policy, now });
    return this.resultFor(transaction);
  }
}

const policy: PendingReferenceRetryPolicy = { maxAttempts: 8, ttlHours: 24 };

describe('PendingReferenceRetryWorker.runOnce', () => {
  it('nao chama o use case quando nao ha candidatos elegiveis', async () => {
    const repository = new FakeWagerTransactionRepository();
    const unitOfWork = new PassthroughUnitOfWork();
    const useCase = new RecordingUseCase(() => ({
      transactionId: 'x',
      status: WagerTransactionStatus.PENDING_REFERENCE,
      idempotentReplay: false,
    }));
    const worker = new PendingReferenceRetryWorker({
      unitOfWork,
      wagerTransactionRepository: repository as unknown as WagerTransactionRepository,
      useCase: useCase as never,
      clock: new FixedClock(new Date('2026-08-13T00:10:00.000Z')),
      batchSize: 5,
      retryPolicy: policy,
    });

    const processed = await worker.runOnce();

    expect(processed).toBe(0);
    expect(useCase.calls).toHaveLength(0);
  });

  it('processa cada candidato elegivel em uma transacao propria, ate o batchSize', async () => {
    const repository = new FakeWagerTransactionRepository();
    repository.seed(pendingRefund('tx-1'), 'game-1');
    repository.seed(pendingRefund('tx-2'), 'game-2');
    repository.seed(pendingRefund('tx-3'), 'game-3');
    const unitOfWork = new PassthroughUnitOfWork();
    const useCase = new RecordingUseCase((transaction) => ({
      transactionId: transaction.id,
      status: WagerTransactionStatus.PROCESSED,
      idempotentReplay: false,
    }));
    const now = new Date('2026-08-13T00:10:00.000Z');
    const worker = new PendingReferenceRetryWorker({
      unitOfWork,
      wagerTransactionRepository: repository as unknown as WagerTransactionRepository,
      useCase: useCase as never,
      clock: new FixedClock(now),
      batchSize: 2,
      retryPolicy: policy,
    });

    const processed = await worker.runOnce();

    expect(processed).toBe(2);
    expect(useCase.calls).toHaveLength(2);
    expect(useCase.calls[0]?.now).toEqual(now);
    expect(useCase.calls[0]?.policy).toEqual(policy);
    expect(unitOfWork.runCount).toBe(2);
  });

  it('nao reprocessa uma transacao ja resolvida por uma chamada anterior no mesmo tick', async () => {
    const repository = new FakeWagerTransactionRepository();
    repository.seed(pendingRefund('tx-1'), 'game-1');
    const unitOfWork = new PassthroughUnitOfWork();
    const useCase = new RecordingUseCase((transaction) => {
      const candidate = repository.store.get(transaction.id);
      if (candidate !== undefined) {
        repository.store.delete(transaction.id);
      }
      return { transactionId: transaction.id, status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });
    const worker = new PendingReferenceRetryWorker({
      unitOfWork,
      wagerTransactionRepository: repository as unknown as WagerTransactionRepository,
      useCase: useCase as never,
      clock: new FixedClock(new Date('2026-08-13T00:10:00.000Z')),
      batchSize: 10,
      retryPolicy: policy,
    });

    const processed = await worker.runOnce();

    expect(processed).toBe(1);
    expect(useCase.calls).toHaveLength(1);
  });

  it('respeita a janela de elegibilidade — ignora transacoes cujo nextAttemptAt ainda nao chegou', async () => {
    const repository = new FakeWagerTransactionRepository();
    const now = new Date('2026-08-13T00:10:00.000Z');
    repository.seed(pendingRefund('tx-futuro', { nextAttemptAt: new Date(now.getTime() + 60_000) }));
    repository.seed(pendingRefund('tx-devido', { nextAttemptAt: new Date(now.getTime() - 1_000) }));
    const unitOfWork = new PassthroughUnitOfWork();
    const useCase = new RecordingUseCase((transaction) => ({
      transactionId: transaction.id,
      status: WagerTransactionStatus.PROCESSED,
      idempotentReplay: false,
    }));
    const worker = new PendingReferenceRetryWorker({
      unitOfWork,
      wagerTransactionRepository: repository as unknown as WagerTransactionRepository,
      useCase: useCase as never,
      clock: new FixedClock(now),
      batchSize: 1,
      retryPolicy: policy,
    });

    await worker.runOnce();

    expect(useCase.calls).toHaveLength(1);
    expect(useCase.calls[0]?.transaction.id).toBe('tx-devido');
  });

  it('passa gameId do candidato adiante para o use case', async () => {
    const repository = new FakeWagerTransactionRepository();
    repository.seed(pendingRefund('tx-1'), 'game-42');
    const unitOfWork = new PassthroughUnitOfWork();
    const useCase = new RecordingUseCase((transaction) => ({
      transactionId: transaction.id,
      status: WagerTransactionStatus.PROCESSED,
      idempotentReplay: false,
    }));
    const worker = new PendingReferenceRetryWorker({
      unitOfWork,
      wagerTransactionRepository: repository as unknown as WagerTransactionRepository,
      useCase: useCase as never,
      clock: new FixedClock(new Date('2026-08-13T00:10:00.000Z')),
      batchSize: 1,
      retryPolicy: policy,
    });

    await worker.runOnce();

    expect(useCase.calls[0]?.gameId).toBe('game-42');
  });
});

describe('PendingReferenceRetryWorker.start/stop', () => {
  it('agenda execucoes periodicas e permite parar', async () => {
    const repository = new FakeWagerTransactionRepository();
    const unitOfWork = new PassthroughUnitOfWork();
    const useCase = new RecordingUseCase(() => ({
      transactionId: 'x',
      status: WagerTransactionStatus.PENDING_REFERENCE,
      idempotentReplay: false,
    }));
    const worker = new PendingReferenceRetryWorker({
      unitOfWork,
      wagerTransactionRepository: repository as unknown as WagerTransactionRepository,
      useCase: useCase as never,
      clock: new FixedClock(new Date('2026-08-13T00:10:00.000Z')),
      batchSize: 10,
      retryPolicy: policy,
    });

    worker.start(5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    worker.stop();
    const runsAfterStop = repository.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(runsAfterStop).toBeGreaterThan(0);
    expect(repository.calls.length).toBe(runsAfterStop);
  });
});
