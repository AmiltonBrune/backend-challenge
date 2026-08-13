import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
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
}
