import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry-error.ts';
import type { Money } from '../money/money.ts';
import { LedgerDirection } from './ledger-direction.ts';
import type { WalletLedgerEntryProps } from './wallet-ledger-entry-props.ts';

export class WalletLedgerEntry {
  public readonly id: string;
  public readonly walletId: string;
  public readonly transactionId: string;
  public readonly direction: LedgerDirection;
  public readonly money: Money;
  public readonly balanceBefore: Money;
  public readonly balanceAfter: Money;
  private readonly _createdAt: Date;

  private constructor(props: WalletLedgerEntryProps) {
    this.id = props.id;
    this.walletId = props.walletId;
    this.transactionId = props.transactionId;
    this.direction = props.direction;
    this.money = props.money;
    this.balanceBefore = props.balanceBefore;
    this.balanceAfter = props.balanceAfter;
    this._createdAt = new Date(props.createdAt.getTime());
  }

  get createdAt(): Date {
    return new Date(this._createdAt.getTime());
  }

  static create(props: WalletLedgerEntryProps): WalletLedgerEntry {
    if (!props.money.isPositive()) {
      throw new InvalidLedgerEntryError('money deve ser estritamente positivo');
    }

    const entry = new WalletLedgerEntry(props);
    if (!entry.isBalanced()) {
      throw new InvalidLedgerEntryError('balanceBefore ± money não resulta em balanceAfter');
    }

    return entry;
  }

  static rehydrate(props: WalletLedgerEntryProps): WalletLedgerEntry {
    return new WalletLedgerEntry(props);
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.CREDIT
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);

    return expected.equals(this.balanceAfter);
  }
}
