import type { MoneyProps } from '../money/money-props.ts';
import { IntegrationEvent } from './integration-event.ts';
import type { IntegrationEventProps } from './integration-event-props.ts';

export interface WalletOpenedData {
  readonly walletId: string;
  readonly playerId: string;
  readonly currency: string;
  readonly initialBalance: MoneyProps;
  readonly openedAt: Date;
}

export class WalletOpened extends IntegrationEvent<WalletOpenedData> {
  readonly eventType = 'WalletOpened';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WalletOpenedData>) {
    super(props);
  }
}
