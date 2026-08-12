import type { WagerTransactionKind } from '../wager-transaction/wager-transaction-kind.ts';
import { IntegrationEvent } from './integration-event.ts';
import type { IntegrationEventProps } from './integration-event-props.ts';

export interface WagerTransactionPendingReferenceData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly kind: WagerTransactionKind;
  readonly referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>) {
    super(props);
  }
}
