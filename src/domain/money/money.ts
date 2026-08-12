import { Decimal } from 'decimal.js';
import { CurrencyMismatchError } from '../errors/currency-mismatch-error.ts';
import type { MoneyProps } from './money-props.ts';

const AMOUNT_PATTERN = /^\d{1,17}(\.\d{1,2})?$/;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (props.currency === '') {
      throw new Error('Money: currency não pode ser vazia.');
    }
    if (!AMOUNT_PATTERN.test(props.amount)) {
      throw new Error(
        `Money: amount "${props.amount}" inválido — esperado decimal não negativo, até 17 dígitos inteiros e até 2 casas decimais.`,
      );
    }
    return new Money(new Decimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
