import type { LedgerDirection } from '../ledger/ledger-direction.ts';
import type { MoneyProps } from '../money/money-props.ts';
import { IntegrationEvent } from './integration-event.ts';
import type { IntegrationEventProps } from './integration-event-props.ts';

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }
}
