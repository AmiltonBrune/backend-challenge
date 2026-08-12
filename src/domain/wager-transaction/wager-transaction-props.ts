import type { FailureCode } from '../errors/failure-code.ts';
import type { Money } from '../money/money.ts';
import type { WagerTransactionKind } from './wager-transaction-kind.ts';
import type { WagerTransactionStatus } from './wager-transaction-status.ts';

export interface CreateWagerTransactionProps {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt: Date;
}

export interface RehydrateWagerTransactionProps extends CreateWagerTransactionProps {
  readonly referenceTransactionId?: string;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: FailureCode;
  readonly processedAt?: Date;
}
