import type { Wallet } from '@domain/wallet/wallet.ts';
import type { TransactionContext } from './transaction-context.ts';

export interface WalletRepository {
  findById(ctx: TransactionContext, id: string): Promise<Wallet | undefined>;
  findByIdForUpdate(ctx: TransactionContext, id: string): Promise<Wallet | undefined>;
  findByPlayerAndCurrency(
    ctx: TransactionContext,
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined>;
  insert(ctx: TransactionContext, wallet: Wallet): Promise<void>;
  update(ctx: TransactionContext, wallet: Wallet): Promise<void>;
}
