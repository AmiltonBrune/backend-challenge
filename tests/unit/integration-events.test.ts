import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { IntegrationEvent } from '@domain/events/integration-event.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import { WagerTransactionRejected } from '@domain/events/wager-transaction-rejected.ts';
import { WagerTransactionPendingReference } from '@domain/events/wager-transaction-pending-reference.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';

const occurredAt = new Date('2026-08-12T00:00:00.000Z');

function buildProcessed(): WagerTransactionProcessed {
  return new WagerTransactionProcessed({
    eventId: 'evt-1',
    aggregateId: 'tx-1',
    correlationId: 'corr-1',
    occurredAt,
    data: {
      transactionId: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      walletId: 'wallet-1',
      kind: 'BET',
      money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
    },
  });
}

describe('WagerTransactionProcessed', () => {
  it('declara eventType e version na subclasse', () => {
    const event = buildProcessed();

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
    expect(event).toBeInstanceOf(IntegrationEvent);
  });

  it('toJSON produz envelope com occurredAt ISO-8601 e data com Money como string', () => {
    const json = buildProcessed().toJSON();

    expect(json.eventType).toBe('WagerTransactionProcessed');
    expect(json.occurredAt).toBe('2026-08-12T00:00:00.000Z');
    expect(json.data.money.amount).toBe('25.00');
    expect(typeof json.data.money.amount).toBe('string');
  });
});

describe('WagerTransactionRejected', () => {
  it('carrega failureCode no payload', () => {
    const event = new WagerTransactionRejected({
      eventId: 'evt-2',
      aggregateId: 'tx-2',
      correlationId: 'corr-2',
      occurredAt,
      data: {
        transactionId: 'tx-2',
        providerId: 'provider-a',
        externalTransactionId: 'ext-2',
        walletId: 'wallet-1',
        kind: 'BET',
        failureCode: FailureCode.INSUFFICIENT_FUNDS,
      },
    });

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.version).toBe(1);
    expect(event.toJSON().data.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
  });
});

describe('WagerTransactionPendingReference', () => {
  it('carrega a referencia externa aguardada', () => {
    const event = new WagerTransactionPendingReference({
      eventId: 'evt-3',
      aggregateId: 'tx-3',
      correlationId: 'corr-3',
      occurredAt,
      data: {
        transactionId: 'tx-3',
        providerId: 'provider-a',
        externalTransactionId: 'ext-3',
        walletId: 'wallet-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'ext-bet-1',
      },
    });

    expect(event.eventType).toBe('WagerTransactionPendingReference');
    expect(event.version).toBe(1);
    expect(event.toJSON().data.referenceExternalTransactionId).toBe('ext-bet-1');
  });
});

describe('WalletBalanceChanged', () => {
  it('carrega balanceBefore e balanceAfter como MoneyProps', () => {
    const event = new WalletBalanceChanged({
      eventId: 'evt-4',
      aggregateId: 'wallet-1',
      correlationId: 'corr-4',
      occurredAt,
      data: {
        walletId: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }).toJSON(),
        balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }).toJSON(),
        walletVersion: 2,
      },
    });

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.version).toBe(1);
    const json = event.toJSON();
    expect(json.data.balanceBefore.amount).toBe('100.00');
    expect(json.data.balanceAfter.amount).toBe('75.00');
    expect(json.data.walletVersion).toBe(2);
  });
});

describe('IntegrationEvent — imutabilidade de occurredAt', () => {
  it('mutar a Date original nao afeta o evento', () => {
    const input = new Date('2026-08-12T00:00:00.000Z');
    const event = new WagerTransactionProcessed({
      eventId: 'evt-1',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt: input,
      data: {
        transactionId: 'tx-1',
        providerId: 'provider-a',
        externalTransactionId: 'ext-1',
        walletId: 'wallet-1',
        kind: 'BET',
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
      },
    });

    input.setFullYear(1999);

    expect(event.occurredAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('mutar o occurredAt retornado nao afeta o evento', () => {
    const event = buildProcessed();

    event.occurredAt.setFullYear(1999);

    expect(event.occurredAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });
});

describe('IntegrationEvent — serialização determinística', () => {
  it('a mesma entrada serializada duas vezes produz JSON idêntico byte a byte', () => {
    const props = {
      eventId: 'evt-1',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt,
      data: {
        transactionId: 'tx-1',
        providerId: 'provider-a',
        externalTransactionId: 'ext-1',
        walletId: 'wallet-1',
        kind: 'BET',
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
      },
    };

    const first = JSON.stringify(new WagerTransactionProcessed(props).toJSON());
    const second = JSON.stringify(new WagerTransactionProcessed(props).toJSON());

    expect(first).toBe(second);
  });
});
