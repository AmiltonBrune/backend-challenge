import { IntegrationEvent } from './integration-event.ts';
import type { IntegrationEventProps } from './integration-event-props.ts';

export interface WagerTransactionPendingReferenceData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly referenceExternalTransactionId: string;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>) {
    super(props);
  }
}
