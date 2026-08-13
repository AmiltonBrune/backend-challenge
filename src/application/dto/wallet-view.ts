import type { MoneyProps } from '@domain/money/money-props.ts';

export interface WalletView {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
  readonly updatedAt: Date;
}
