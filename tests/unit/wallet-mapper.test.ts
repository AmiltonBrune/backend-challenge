import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { WalletEntity } from '@infrastructure/persistence/entities/wallet.entity.ts';
import { WalletMapper } from '@infrastructure/persistence/mappers/wallet.mapper.ts';

function buildEntity(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    id: 'wallet-1',
    playerId: 'player-1',
    currency: 'BRL',
    balanceAmount: '100.00',
    version: 3,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('WalletMapper.toDomain', () => {
  it('reconstroi a Wallet com o saldo e a version persistidos', () => {
    const wallet = WalletMapper.toDomain(buildEntity());

    expect(wallet.id).toBe('wallet-1');
    expect(wallet.playerId).toBe('player-1');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balance().toJSON().amount).toBe('100.00');
    expect(wallet.version()).toBe(3);
  });

  it('usa rehydrate, nao open — nao lanca para version que open jamais produziria', () => {
    expect(() => WalletMapper.toDomain(buildEntity({ version: 999 }))).not.toThrow();
    expect(WalletMapper.toDomain(buildEntity({ version: 999 })).version()).toBe(999);
  });
});

describe('WalletMapper.toEntity', () => {
  it('serializa a Wallet de volta para a forma persistida', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: Money.from({ amount: '250.50', currency: 'BRL' }),
      version: 5,
    });
    const timestamps = {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    };

    const entity = WalletMapper.toEntity(wallet, timestamps);

    expect(entity.id).toBe('wallet-1');
    expect(entity.balanceAmount).toBe('250.50');
    expect(entity.version).toBe(5);
    expect(entity.createdAt).toBe(timestamps.createdAt);
    expect(entity.updatedAt).toBe(timestamps.updatedAt);
  });
});

describe('WalletMapper — round trip', () => {
  it('toEntity(toDomain(entity)) preserva os campos de negocio', () => {
    const original = buildEntity();
    const wallet = WalletMapper.toDomain(original);
    const roundTripped = WalletMapper.toEntity(wallet, {
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    });

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.playerId).toBe(original.playerId);
    expect(roundTripped.currency).toBe(original.currency);
    expect(roundTripped.balanceAmount).toBe(original.balanceAmount);
    expect(roundTripped.version).toBe(original.version);
  });
});
