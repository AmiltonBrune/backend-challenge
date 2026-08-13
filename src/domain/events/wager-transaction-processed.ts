import type { MoneyProps } from '../money/money-props.ts';
import type { WagerTransactionKind } from '../wager-transaction/wager-transaction-kind.ts';
import { IntegrationEvent } from './integration-event.ts';
import type { IntegrationEventProps } from './integration-event-props.ts';

export interface WagerTransactionProcessedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId?: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceTransactionId?: string;
  readonly processedAt: Date;
  readonly balanceAfter?: MoneyProps;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }
}
