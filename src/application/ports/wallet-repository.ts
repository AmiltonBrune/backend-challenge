import type { WalletView } from '@application/dto/wallet-view.ts';
import type { Wallet } from '@domain/wallet/wallet.ts';
import type { TransactionContext } from './transaction-context.ts';

export interface WalletRepository {
  findById(ctx: TransactionContext, id: string): Promise<Wallet | undefined>;
  findViewById(ctx: TransactionContext, id: string): Promise<WalletView | undefined>;
  findByIdForUpdate(ctx: TransactionContext, id: string): Promise<Wallet | undefined>;
  findByPlayerAndCurrency(
    ctx: TransactionContext,
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined>;
  insert(ctx: TransactionContext, wallet: Wallet): Promise<void>;
  update(ctx: TransactionContext, wallet: Wallet): Promise<void>;
}
