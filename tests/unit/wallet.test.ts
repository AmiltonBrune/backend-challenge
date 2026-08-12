import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { CurrencyMismatchError } from '@domain/errors/currency-mismatch-error.ts';
import { InsufficientFundsError } from '@domain/errors/insufficient-funds-error.ts';

const money = (amount: string, currency = 'BRL') => Money.from({ amount, currency });
const createdAt = new Date('2026-08-12T00:00:00.000Z');

describe('Wallet.open', () => {
  it('abre com saldo zero e version 1 quando saldo inicial nao e informado', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL' });

    expect(wallet.balance().toJSON().amount).toBe('0.00');
    expect(wallet.version()).toBe(1);
  });

  it('abre com o saldo inicial informado, version continua 1', () => {
    const wallet = Wallet.open({
      id: 'w1',
      playerId: 'p1',
      currency: 'BRL',
      initialBalance: money('100.00'),
    });

    expect(wallet.balance().toJSON().amount).toBe('100.00');
    expect(wallet.version()).toBe(1);
  });

  it('lanca CurrencyMismatchError quando o saldo inicial e de outra moeda', () => {
    expect(() =>
      Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('10.00', 'USD') }),
    ).toThrow(CurrencyMismatchError);
  });
});

describe('Wallet.debit', () => {
  it('debita, decrementa o saldo e incrementa a version', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('100.00') });

    const entry = wallet.debit({ money: money('25.00'), transactionId: 'tx-1', entryId: 'e1', createdAt });

    expect(wallet.balance().toJSON().amount).toBe('75.00');
    expect(wallet.version()).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.DEBIT);
    expect(entry.balanceBefore.toJSON().amount).toBe('100.00');
    expect(entry.balanceAfter.toJSON().amount).toBe('75.00');
    expect(entry.walletId).toBe('w1');
    expect(entry.transactionId).toBe('tx-1');
  });

  it('permite debitar exatamente o saldo total, zerando a wallet', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('50.00') });

    wallet.debit({ money: money('50.00'), transactionId: 'tx-1', entryId: 'e1', createdAt });

    expect(wallet.balance().toJSON().amount).toBe('0.00');
  });

  it('lanca InsufficientFundsError sem alterar saldo nem version', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('10.00') });

    expect(() =>
      wallet.debit({ money: money('80.00'), transactionId: 'tx-1', entryId: 'e1', createdAt }),
    ).toThrow(InsufficientFundsError);
    expect(wallet.balance().toJSON().amount).toBe('10.00');
    expect(wallet.version()).toBe(1);
  });

  it('lanca CurrencyMismatchError sem alterar saldo nem version', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('100.00') });

    expect(() =>
      wallet.debit({ money: money('25.00', 'USD'), transactionId: 'tx-1', entryId: 'e1', createdAt }),
    ).toThrow(CurrencyMismatchError);
    expect(wallet.balance().toJSON().amount).toBe('100.00');
    expect(wallet.version()).toBe(1);
  });
});

describe('Wallet.credit', () => {
  it('credita, incrementa o saldo e a version', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('100.00') });

    const entry = wallet.credit({ money: money('50.00'), transactionId: 'tx-2', entryId: 'e2', createdAt });

    expect(wallet.balance().toJSON().amount).toBe('150.00');
    expect(wallet.version()).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.CREDIT);
    expect(entry.balanceBefore.toJSON().amount).toBe('100.00');
    expect(entry.balanceAfter.toJSON().amount).toBe('150.00');
  });

  it('lanca CurrencyMismatchError sem alterar saldo nem version', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('100.00') });

    expect(() =>
      wallet.credit({ money: money('25.00', 'USD'), transactionId: 'tx-2', entryId: 'e2', createdAt }),
    ).toThrow(CurrencyMismatchError);
    expect(wallet.balance().toJSON().amount).toBe('100.00');
    expect(wallet.version()).toBe(1);
  });
});

describe('Wallet — sequencia de operacoes', () => {
  it('version incrementa a cada movimento, saldo reflete a sequencia', () => {
    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL', initialBalance: money('100.00') });

    wallet.debit({ money: money('30.00'), transactionId: 'tx-1', entryId: 'e1', createdAt });
    wallet.credit({ money: money('10.00'), transactionId: 'tx-2', entryId: 'e2', createdAt });
    wallet.debit({ money: money('5.00'), transactionId: 'tx-3', entryId: 'e3', createdAt });

    expect(wallet.balance().toJSON().amount).toBe('75.00');
    expect(wallet.version()).toBe(4);
  });
});

describe('Wallet.rehydrate', () => {
  it('reconstroi exatamente o estado informado, sem validar', () => {
    const wallet = Wallet.rehydrate({
      id: 'w1',
      playerId: 'p1',
      currency: 'BRL',
      balance: money('42.00'),
      version: 7,
    });

    expect(wallet.balance().toJSON().amount).toBe('42.00');
    expect(wallet.version()).toBe(7);
    expect(wallet.id).toBe('w1');
    expect(wallet.playerId).toBe('p1');
    expect(wallet.currency).toBe('BRL');
  });
});
