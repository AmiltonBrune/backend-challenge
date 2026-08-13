import type { FailureCode } from '../errors/failure-code.ts';
import type { MoneyProps } from '../money/money-props.ts';
import type { WagerTransactionKind } from '../wager-transaction/wager-transaction-kind.ts';
import { IntegrationEvent } from './integration-event.ts';
import type { IntegrationEventProps } from './integration-event-props.ts';

export interface WagerTransactionRejectedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly failureCode: FailureCode;
  readonly rejectedAt: Date;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }
}
