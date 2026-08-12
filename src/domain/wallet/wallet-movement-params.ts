import type { Money } from '../money/money.ts';

export interface WalletMovementParams {
  readonly money: Money;
  readonly transactionId: string;
  readonly entryId: string;
  readonly createdAt: Date;
}
