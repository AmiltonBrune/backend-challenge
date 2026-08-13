import type { FailureCode } from '@domain/errors/failure-code.ts';
import type { MoneyProps } from '@domain/money/money-props.ts';
import type { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import type { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';

export interface WagerTransactionView {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string | null;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly status: WagerTransactionStatus;
  readonly failureCode: FailureCode | null;
  readonly referenceTransactionId: string | null;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
}
