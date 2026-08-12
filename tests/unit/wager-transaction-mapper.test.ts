import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionEntity } from '@infrastructure/persistence/entities/wager-transaction.entity.ts';
import { WagerTransactionMapper } from '@infrastructure/persistence/mappers/wager-transaction.mapper.ts';

function buildEntity(overrides: Partial<WagerTransactionEntity> = {}): WagerTransactionEntity {
  return {
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'idem-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: null,
    kind: 'BET',
    moneyAmount: '25.00',
    moneyCurrency: 'BRL',
    referenceExternalTransactionId: null,
    referenceTransactionId: null,
    status: 'PENDING',
    failureCode: null,
    processedAt: null,
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('WagerTransactionMapper.toDomain', () => {
  it('reconstroi os campos basicos', () => {
    const tx = WagerTransactionMapper.toDomain(buildEntity());

    expect(tx.id).toBe('tx-1');
    expect(tx.kind).toBe(WagerTransactionKind.BET);
    expect(tx.status()).toBe(WagerTransactionStatus.PENDING);
    expect(tx.money.toJSON().amount).toBe('25.00');
    expect(tx.referenceExternalTransactionId).toBeUndefined();
    expect(tx.failureCode()).toBeUndefined();
  });

  it('usa rehydrate — reconstroi REFUND PROCESSED sem referenceExternalTransactionId sem lancar', () => {
    const entity = buildEntity({
      kind: 'REFUND',
      status: 'PROCESSED',
      referenceExternalTransactionId: null,
    });

    expect(() => WagerTransactionMapper.toDomain(entity)).not.toThrow();
  });

  it('preserva failureCode, referenceTransactionId e processedAt quando presentes', () => {
    const processedAt = new Date('2026-08-12T00:05:00.000Z');
    const entity = buildEntity({
      status: 'REJECTED',
      failureCode: 'INSUFFICIENT_FUNDS',
      referenceTransactionId: 'tx-ref-1',
      processedAt,
    });

    const tx = WagerTransactionMapper.toDomain(entity);

    expect(tx.status()).toBe(WagerTransactionStatus.REJECTED);
    expect(tx.failureCode()).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(tx.referenceTransactionId()).toBe('tx-ref-1');
    expect(tx.processedAt()?.toISOString()).toBe(processedAt.toISOString());
  });
});

describe('WagerTransactionMapper.toEntity', () => {
  it('serializa de volta para a forma persistida, aceitando gameId externamente', () => {
    const tx = WagerTransaction.create({
      id: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'idem-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    const entity = WagerTransactionMapper.toEntity(tx, 'game-1');

    expect(entity.id).toBe('tx-1');
    expect(entity.gameId).toBe('game-1');
    expect(entity.moneyAmount).toBe('25.00');
    expect(entity.moneyCurrency).toBe('BRL');
    expect(entity.status).toBe('PENDING');
    expect(entity.referenceExternalTransactionId).toBeNull();
    expect(entity.failureCode).toBeNull();
    expect(entity.processedAt).toBeNull();
  });

  it('reflete o estado apos markProcessed', () => {
    const tx = WagerTransaction.create({
      id: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'idem-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
    });
    const processedAt = new Date('2026-08-12T00:05:00.000Z');
    tx.markProcessed(undefined, processedAt);

    const entity = WagerTransactionMapper.toEntity(tx, null);

    expect(entity.status).toBe('PROCESSED');
    expect(entity.processedAt?.toISOString()).toBe(processedAt.toISOString());
  });
});
