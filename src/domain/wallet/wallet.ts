import { CurrencyMismatchError } from '../errors/currency-mismatch-error.ts';
import { InsufficientFundsError } from '../errors/insufficient-funds-error.ts';
import { LedgerDirection } from '../ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.ts';
import { Money } from '../money/money.ts';
import type { WalletMovementParams } from './wallet-movement-params.ts';

interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly initialBalance?: Money;
}

interface RehydrateWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
}

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  private _balance: Money;
  private _version: number;

  private constructor(id: string, playerId: string, currency: string, balance: Money, version: number) {
    this.id = id;
    this.playerId = playerId;
    this.currency = currency;
    this._balance = balance;
    this._version = version;
  }

  static open(props: OpenWalletProps): Wallet {
    const initialBalance = props.initialBalance ?? Money.zero(props.currency);
    if (initialBalance.currency !== props.currency) {
      throw new CurrencyMismatchError(props.currency, initialBalance.currency);
    }

    return new Wallet(props.id, props.playerId, props.currency, initialBalance, 1);
  }

  static rehydrate(props: RehydrateWalletProps): Wallet {
    return new Wallet(props.id, props.playerId, props.currency, props.balance, props.version);
  }

  balance(): Money {
    return this._balance;
  }

  version(): number {
    return this._version;
  }

  debit(params: WalletMovementParams): WalletLedgerEntry {
    this.assertSameCurrency(params.money);
    if (this._balance.isLessThan(params.money)) {
      throw new InsufficientFundsError(
        params.money.toJSON().amount,
        this._balance.toJSON().amount,
        this.currency,
      );
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(params.money);
    const entry = WalletLedgerEntry.create({
      id: params.entryId,
      walletId: this.id,
      transactionId: params.transactionId,
      direction: LedgerDirection.DEBIT,
      money: params.money,
      balanceBefore,
      balanceAfter,
      createdAt: params.createdAt,
    });

    this._balance = balanceAfter;
    this._version += 1;

    return entry;
  }

  credit(params: WalletMovementParams): WalletLedgerEntry {
    this.assertSameCurrency(params.money);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(params.money);
    const entry = WalletLedgerEntry.create({
      id: params.entryId,
      walletId: this.id,
      transactionId: params.transactionId,
      direction: LedgerDirection.CREDIT,
      money: params.money,
      balanceBefore,
      balanceAfter,
      createdAt: params.createdAt,
    });

    this._balance = balanceAfter;
    this._version += 1;

    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
