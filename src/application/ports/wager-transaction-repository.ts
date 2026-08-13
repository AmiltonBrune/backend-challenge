import type { WagerTransactionView } from '@application/dto/wager-transaction-view.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import type { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import type { TransactionContext } from './transaction-context.ts';

export interface WagerTransactionRepository {
  insert(ctx: TransactionContext, transaction: WagerTransaction, gameId: string | null): Promise<void>;
  update(ctx: TransactionContext, transaction: WagerTransaction): Promise<void>;
  findById(ctx: TransactionContext, id: string): Promise<WagerTransaction | undefined>;
  findByProviderAndIdempotencyKey(
    ctx: TransactionContext,
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined>;
  findByProviderAndExternalTransactionId(
    ctx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined>;
  findProcessedReversalByReference(
    ctx: TransactionContext,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | undefined>;
  findViewById(ctx: TransactionContext, id: string): Promise<WagerTransactionView | undefined>;
  findViewByProviderAndExternalTransactionId(
    ctx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView | undefined>;
}
