import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import type { Money } from '@domain/money/money.ts';
import type { TransactionContext } from './transaction-context.ts';

export interface LedgerRepository {
  insert(ctx: TransactionContext, entry: WalletLedgerEntry): Promise<void>;
  findByTransactionId(
    ctx: TransactionContext,
    transactionId: string,
  ): Promise<WalletLedgerEntry | undefined>;
  sumByWalletId(ctx: TransactionContext, walletId: string, currency: string): Promise<Money>;
  countByWalletId(ctx: TransactionContext, walletId: string): Promise<number>;
}
