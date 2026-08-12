import { describe, expect, it } from 'bun:test';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import { WalletLedgerEntryEntity } from '@infrastructure/persistence/entities/wallet-ledger-entry.entity.ts';
import { WalletLedgerEntryMapper } from '@infrastructure/persistence/mappers/wallet-ledger-entry.mapper.ts';

function buildEntity(overrides: Partial<WalletLedgerEntryEntity> = {}): WalletLedgerEntryEntity {
  return {
    id: 'entry-1',
    walletId: 'wallet-1',
    transactionId: 'tx-1',
    direction: 'DEBIT',
    moneyAmount: '25.00',
    balanceBeforeAmount: '100.00',
    balanceAfterAmount: '75.00',
    currency: 'BRL',
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('WalletLedgerEntryMapper.toDomain', () => {
  it('reconstroi os campos e a aritmetica corretamente', () => {
    const entry = WalletLedgerEntryMapper.toDomain(buildEntity());

    expect(entry.id).toBe('entry-1');
    expect(entry.direction).toBe(LedgerDirection.DEBIT);
    expect(entry.money.toJSON().amount).toBe('25.00');
    expect(entry.balanceBefore.toJSON().amount).toBe('100.00');
    expect(entry.balanceAfter.toJSON().amount).toBe('75.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('usa rehydrate — reconstroi uma linha historicamente desbalanceada sem lancar', () => {
    const entity = buildEntity({ balanceAfterAmount: '999.00' });

    expect(() => WalletLedgerEntryMapper.toDomain(entity)).not.toThrow();
    expect(WalletLedgerEntryMapper.toDomain(entity).isBalanced()).toBe(false);
  });
});

describe('WalletLedgerEntryMapper.toEntity', () => {
  it('serializa de volta para a forma persistida', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-1',
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.CREDIT,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '60.00', currency: 'BRL' }),
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    const entity = WalletLedgerEntryMapper.toEntity(entry);

    expect(entity.direction).toBe('CREDIT');
    expect(entity.moneyAmount).toBe('10.00');
    expect(entity.balanceBeforeAmount).toBe('50.00');
    expect(entity.balanceAfterAmount).toBe('60.00');
    expect(entity.currency).toBe('BRL');
  });
});
