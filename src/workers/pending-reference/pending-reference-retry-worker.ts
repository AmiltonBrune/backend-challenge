import type { Clock } from '@application/ports/clock.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type {
  PendingReferenceRetryPolicy,
  ProcessWagerTransactionResult,
} from '@application/use-cases/process-wager-transaction-use-case.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';

export interface PendingReferenceRetryUseCase {
  retryPendingReference(
    ctx: TransactionContext,
    transaction: WagerTransaction,
    gameId: string | null,
    policy: PendingReferenceRetryPolicy,
    now: Date,
  ): Promise<ProcessWagerTransactionResult>;
}

export interface PendingReferenceRetryWorkerDeps {
  readonly unitOfWork: UnitOfWork;
  readonly wagerTransactionRepository: WagerTransactionRepository;
  readonly useCase: PendingReferenceRetryUseCase;
  readonly clock: Clock;
  readonly batchSize: number;
  readonly retryPolicy: PendingReferenceRetryPolicy;
}

export class PendingReferenceRetryWorker {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: PendingReferenceRetryWorkerDeps) {}

  async runOnce(): Promise<number> {
    const now = this.deps.clock.now();
    let processed = 0;

    for (let i = 0; i < this.deps.batchSize; i += 1) {
      const handled = await this.deps.unitOfWork.run((ctx) => this.processOne(ctx, now));
      if (!handled) {
        break;
      }
      processed += 1;
    }

    return processed;
  }

  start(pollIntervalMs: number): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      this.runOnce().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`falha no worker de reprocessamento de PENDING_REFERENCE: ${message}`);
      });
    }, pollIntervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async processOne(ctx: TransactionContext, now: Date): Promise<boolean> {
    const [candidate] = await this.deps.wagerTransactionRepository.findEligiblePendingReferenceForRetry(
      ctx,
      now,
      1,
    );
    if (candidate === undefined) {
      return false;
    }

    await this.deps.useCase.retryPendingReference(
      ctx,
      candidate.transaction,
      candidate.gameId,
      this.deps.retryPolicy,
      now,
    );
    return true;
  }
}
