import { describe, expect, it } from 'bun:test';
import type { WagerTransactionView } from '@application/dto/wager-transaction-view.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import { WagerTransactionNotFoundError } from '@application/errors/wager-transaction-not-found-error.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { GetWagerTransactionUseCase } from '@application/use-cases/get-wager-transaction-use-case.ts';

class NoopUnitOfWork implements UnitOfWork {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

const view: WagerTransactionView = {
  transactionId: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'ext-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: WagerTransactionKind.BET,
  money: { amount: '25.00', currency: 'BRL' },
  status: WagerTransactionStatus.PROCESSED,
  failureCode: null,
  referenceTransactionId: null,
  createdAt: new Date('2026-08-13T00:00:00.000Z'),
  processedAt: new Date('2026-08-13T00:00:01.000Z'),
};

class FixedWagerTransactionRepository implements WagerTransactionRepository {
  async findViewById(_ctx: TransactionContext, id: string): Promise<WagerTransactionView | undefined> {
    return id === view.transactionId ? view : undefined;
  }

  async findViewByProviderAndExternalTransactionId(
    _ctx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView | undefined> {
    return providerId === view.providerId && externalTransactionId === view.externalTransactionId
      ? view
      : undefined;
  }

  async insert(): Promise<void> {}

  async update(): Promise<void> {}

  async findById(): Promise<WagerTransaction | undefined> {
    return undefined;
  }

  async findByProviderAndIdempotencyKey(): Promise<WagerTransaction | undefined> {
    return undefined;
  }

  async findByProviderAndExternalTransactionId(): Promise<WagerTransaction | undefined> {
    return undefined;
  }

  async findProcessedReversalByReference(): Promise<WagerTransaction | undefined> {
    return undefined;
  }

  async findEligiblePendingReferenceForRetry() {
    return [];
  }
}

function buildUseCase(): GetWagerTransactionUseCase {
  return new GetWagerTransactionUseCase(new NoopUnitOfWork(), new FixedWagerTransactionRepository());
}

describe('GetWagerTransactionUseCase', () => {
  it('busca por transactionId', async () => {
    const result = await buildUseCase().execute({ transactionId: 'tx-1' });
    expect(result).toEqual(view);
  });

  it('busca por (providerId, externalTransactionId)', async () => {
    const result = await buildUseCase().execute({
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
    });
    expect(result).toEqual(view);
  });

  it('lança WagerTransactionNotFoundError quando não encontrado por transactionId', async () => {
    await expect(buildUseCase().execute({ transactionId: 'inexistente' })).rejects.toThrow(
      WagerTransactionNotFoundError,
    );
  });

  it('lança WagerTransactionNotFoundError quando não encontrado por provider+external', async () => {
    await expect(
      buildUseCase().execute({ providerId: 'provider-b', externalTransactionId: 'ext-1' }),
    ).rejects.toThrow(WagerTransactionNotFoundError);
  });
});
