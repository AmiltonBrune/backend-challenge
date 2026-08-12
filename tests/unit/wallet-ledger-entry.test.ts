import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';

const money = (amount: string) => Money.from({ amount, currency: 'BRL' });

const validCreditProps = {
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  direction: LedgerDirection.CREDIT,
  money: money('25.00'),
  balanceBefore: money('100.00'),
  balanceAfter: money('125.00'),
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
};

const validDebitProps = {
  id: 'entry-2',
  walletId: 'wallet-1',
  transactionId: 'tx-2',
  direction: LedgerDirection.DEBIT,
  money: money('25.00'),
  balanceBefore: money('100.00'),
  balanceAfter: money('75.00'),
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
};

describe('WalletLedgerEntry.create — CREDIT', () => {
  it('cria quando balanceBefore + money === balanceAfter', () => {
    const entry = WalletLedgerEntry.create(validCreditProps);

    expect(entry.balanceAfter.toJSON().amount).toBe('125.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('lanca quando a aritmetica nao fecha', () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validCreditProps, balanceAfter: money('999.00') }),
    ).toThrow();
  });
});

describe('WalletLedgerEntry.create — DEBIT', () => {
  it('cria quando balanceBefore - money === balanceAfter', () => {
    const entry = WalletLedgerEntry.create(validDebitProps);

    expect(entry.balanceAfter.toJSON().amount).toBe('75.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('lanca quando a aritmetica nao fecha', () => {
    expect(() =>
      WalletLedgerEntry.create({ ...validDebitProps, balanceAfter: money('1.00') }),
    ).toThrow();
  });
});

describe('WalletLedgerEntry.create — validação de money', () => {
  it('lanca quando money e zero', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...validCreditProps,
        money: Money.zero('BRL'),
        balanceAfter: money('100.00'),
      }),
    ).toThrow();
  });
});

describe('WalletLedgerEntry — imutabilidade e ausência de transição', () => {
  it('nao possui nenhum metodo que altere o estado apos criado', () => {
    const entry = WalletLedgerEntry.create(validCreditProps);
    const before = JSON.stringify({
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
    });

    entry.isBalanced();

    const after = JSON.stringify({
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: entry.money.toJSON(),
      balanceBefore: entry.balanceBefore.toJSON(),
      balanceAfter: entry.balanceAfter.toJSON(),
    });

    expect(after).toBe(before);
  });
});

describe('WalletLedgerEntry.rehydrate', () => {
  it('reconstrói sem revalidar a aritmética', () => {
    const desbalanceado = { ...validCreditProps, balanceAfter: money('999.00') };

    expect(() => WalletLedgerEntry.rehydrate(desbalanceado)).not.toThrow();
  });

  it('isBalanced reflete o estado real mesmo apos rehydrate de linha inconsistente', () => {
    const desbalanceado = { ...validCreditProps, balanceAfter: money('999.00') };
    const entry = WalletLedgerEntry.rehydrate(desbalanceado);

    expect(entry.isBalanced()).toBe(false);
  });
});
