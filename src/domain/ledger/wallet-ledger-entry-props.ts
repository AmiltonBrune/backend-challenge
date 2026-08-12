import type { Money } from '../money/money.ts';
import type { LedgerDirection } from './ledger-direction.ts';

export interface WalletLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;
}
