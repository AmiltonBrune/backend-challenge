import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { IntegrationEvent } from '@domain/events/integration-event.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import { WagerTransactionRejected } from '@domain/events/wager-transaction-rejected.ts';
import { WagerTransactionPendingReference } from '@domain/events/wager-transaction-pending-reference.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { WalletOpened } from '@domain/events/wallet-opened.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';

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
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
      processedAt: occurredAt,
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

  it('carrega gameId, referenceTransactionId e balanceAfter opcionais quando informados', () => {
    const event = new WagerTransactionProcessed({
      eventId: 'evt-1',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt,
      data: {
        transactionId: 'tx-1',
        providerId: 'provider-a',
        externalTransactionId: 'ext-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.ROLLBACK,
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
        referenceTransactionId: 'tx-ref-1',
        processedAt: occurredAt,
        balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }).toJSON(),
      },
    });

    const json = event.toJSON();
    expect(json.data.gameId).toBe('game-1');
    expect(json.data.referenceTransactionId).toBe('tx-ref-1');
    expect(json.data.balanceAfter?.amount).toBe('75.00');
  });
});

describe('WagerTransactionRejected', () => {
  it('carrega failureCode e money no payload', () => {
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
        playerId: 'player-1',
        roundId: 'round-1',
        kind: WagerTransactionKind.BET,
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
        failureCode: FailureCode.INSUFFICIENT_FUNDS,
        rejectedAt: occurredAt,
      },
    });

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.version).toBe(1);
    const json = event.toJSON();
    expect(json.data.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(json.data.money.amount).toBe('25.00');
  });
});

describe('WagerTransactionPendingReference', () => {
  it('carrega a referencia externa aguardada, attempts e nextAttemptAt', () => {
    const nextAttemptAt = new Date('2026-08-12T00:05:00.000Z');
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
        referenceExternalTransactionId: 'ext-bet-1',
        attempts: 1,
        nextAttemptAt,
      },
    });

    expect(event.eventType).toBe('WagerTransactionPendingReference');
    expect(event.version).toBe(1);
    const json = event.toJSON();
    expect(json.data.referenceExternalTransactionId).toBe('ext-bet-1');
    expect(json.data.attempts).toBe(1);
    expect(json.data.nextAttemptAt.toISOString()).toBe('2026-08-12T00:05:00.000Z');
  });
});

describe('WalletBalanceChanged', () => {
  it('carrega transactionId, direction, money, balanceBefore e balanceAfter', () => {
    const event = new WalletBalanceChanged({
      eventId: 'evt-4',
      aggregateId: 'wallet-1',
      correlationId: 'corr-4',
      occurredAt,
      data: {
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.DEBIT,
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }).toJSON(),
        balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }).toJSON(),
        walletVersion: 2,
      },
    });

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.version).toBe(1);
    const json = event.toJSON();
    expect(json.data.transactionId).toBe('tx-1');
    expect(json.data.direction).toBe(LedgerDirection.DEBIT);
    expect(json.data.money.amount).toBe('25.00');
    expect(json.data.balanceBefore.amount).toBe('100.00');
    expect(json.data.balanceAfter.amount).toBe('75.00');
    expect(json.data.walletVersion).toBe(2);
  });
});

describe('WalletOpened', () => {
  it('carrega playerId, currency, initialBalance e openedAt', () => {
    const event = new WalletOpened({
      eventId: 'evt-5',
      aggregateId: 'wallet-1',
      correlationId: 'corr-5',
      occurredAt,
      data: {
        walletId: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        initialBalance: Money.from({ amount: '1000.00', currency: 'BRL' }).toJSON(),
        openedAt: occurredAt,
      },
    });

    expect(event.eventType).toBe('WalletOpened');
    expect(event.version).toBe(1);
    const json = event.toJSON();
    expect(json.data.playerId).toBe('player-1');
    expect(json.data.initialBalance.amount).toBe('1000.00');
    expect(json.data.openedAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
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
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
        processedAt: occurredAt,
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

describe('IntegrationEvent — imutabilidade do payload', () => {
  it('mutar o objeto data original apos construir nao afeta o evento', () => {
    const data = {
      transactionId: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
      processedAt: occurredAt,
    };
    const event = new WagerTransactionProcessed({
      eventId: 'evt-1',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      occurredAt,
      data,
    });

    (data.money as { amount: string }).amount = '999.99';

    expect(event.data.money.amount).toBe('25.00');
  });

  it('mutar o data retornado nao afeta leituras subsequentes', () => {
    const event = buildProcessed();

    (event.data.money as { amount: string }).amount = '999.99';

    expect(event.data.money.amount).toBe('25.00');
    expect(event.toJSON().data.money.amount).toBe('25.00');
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
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
        processedAt: occurredAt,
      },
    };

    const first = JSON.stringify(new WagerTransactionProcessed(props).toJSON());
    const second = JSON.stringify(new WagerTransactionProcessed(props).toJSON());

    expect(first).toBe(second);
  });
});
