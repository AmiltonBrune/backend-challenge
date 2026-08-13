import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';

function buildEvent(): WagerTransactionProcessed {
  return new WagerTransactionProcessed({
    eventId: 'evt-1',
    aggregateId: 'tx-1',
    correlationId: 'corr-1',
    occurredAt: new Date('2026-08-12T00:00:00.000Z'),
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
      processedAt: new Date('2026-08-12T00:00:00.000Z'),
    },
  });
}

describe('OutboxMessage.enqueue', () => {
  it('deriva id, aggregateId, eventType, payload e occurredAt do evento', () => {
    const message = OutboxMessage.enqueue(buildEvent());

    expect(message.id).toBe('evt-1');
    expect(message.aggregateId).toBe('tx-1');
    expect(message.eventType).toBe('WagerTransactionProcessed');
    expect(message.payload.eventType).toBe('WagerTransactionProcessed');
    expect(message.occurredAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('nao expoe o payload por referencia — mutar o retorno nao afeta leituras subsequentes', () => {
    const message = OutboxMessage.enqueue(buildEvent());

    (message.payload as { eventType: string }).eventType = 'Adulterado';

    expect(message.payload.eventType).toBe('WagerTransactionProcessed');
  });

  it('e pendente e ja esta due imediatamente — sem next_attempt_at ela nunca espera', () => {
    const message = OutboxMessage.enqueue(buildEvent());

    expect(message.isPending()).toBe(true);
    expect(message.isDue(new Date('2026-08-12T00:00:00.000Z'))).toBe(true);
    expect(message.attempts()).toBe(0);
  });
});

describe('OutboxMessage.markPublished', () => {
  it('marca como publicada, deixando de ser pendente e de estar due', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    const at = new Date('2026-08-12T00:05:00.000Z');

    message.markPublished(at);

    expect(message.isPending()).toBe(false);
    expect(message.publishedAt()?.toISOString()).toBe('2026-08-12T00:05:00.000Z');
    expect(message.isDue(at)).toBe(false);
  });

  it('lanca ao publicar uma mensagem ja publicada', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    message.markPublished(new Date('2026-08-12T00:05:00.000Z'));

    expect(() => message.markPublished(new Date('2026-08-12T00:06:00.000Z'))).toThrow();
  });
});

describe('OutboxMessage.scheduleRetry', () => {
  it('incrementa attempts e agenda next_attempt_at com backoff 2^attempts segundos', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    const now = new Date('2026-08-12T00:00:00.000Z');

    message.scheduleRetry(now);

    expect(message.attempts()).toBe(1);
    const next = message.nextAttemptAt();
    expect(next).toBeDefined();
    const deltaMs = (next as Date).getTime() - now.getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(2000);
    expect(deltaMs).toBeLessThanOrEqual(2000 * 1.2 + 1);
  });

  it('deixa de estar due enquanto next_attempt_at nao chega, volta a estar due depois', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    const now = new Date('2026-08-12T00:00:00.000Z');
    message.scheduleRetry(now);

    expect(message.isDue(now)).toBe(false);

    const muitoDepois = new Date(now.getTime() + 10_000);
    expect(message.isDue(muitoDepois)).toBe(true);
  });

  it('teto de 300 segundos independentemente de quantas tentativas', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    const now = new Date('2026-08-12T00:00:00.000Z');

    for (let i = 0; i < 10; i++) {
      message.scheduleRetry(now);
    }

    expect(message.attempts()).toBe(10);
    const next = message.nextAttemptAt();
    const deltaSeconds = ((next as Date).getTime() - now.getTime()) / 1000;
    expect(deltaSeconds).toBeGreaterThanOrEqual(300);
    expect(deltaSeconds).toBeLessThanOrEqual(300 * 1.2 + 0.1);
  });

  it('lanca ao reagendar uma mensagem ja publicada', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    message.markPublished(new Date('2026-08-12T00:05:00.000Z'));

    expect(() => message.scheduleRetry(new Date('2026-08-12T00:06:00.000Z'))).toThrow();
  });
});

describe('OutboxMessage.rehydrate', () => {
  it('reconstroi o estado exatamente como informado, sem revalidar', () => {
    const occurredAt = new Date('2026-08-12T00:00:00.000Z');
    const nextAttemptAt = new Date('2026-08-12T00:05:00.000Z');
    const message = OutboxMessage.rehydrate({
      id: 'evt-1',
      aggregateId: 'tx-1',
      eventType: 'WagerTransactionProcessed',
      payload: buildEvent().toJSON(),
      occurredAt,
      attempts: 3,
      nextAttemptAt,
      publishedAt: undefined,
    });

    expect(message.attempts()).toBe(3);
    expect(message.nextAttemptAt()?.toISOString()).toBe(nextAttemptAt.toISOString());
    expect(message.occurredAt.toISOString()).toBe(occurredAt.toISOString());
    expect(message.isPending()).toBe(true);
  });

  it('reconstroi uma mensagem ja publicada', () => {
    const publishedAt = new Date('2026-08-12T00:10:00.000Z');
    const message = OutboxMessage.rehydrate({
      id: 'evt-1',
      aggregateId: 'tx-1',
      eventType: 'WagerTransactionProcessed',
      payload: buildEvent().toJSON(),
      occurredAt: new Date('2026-08-12T00:00:00.000Z'),
      attempts: 1,
      nextAttemptAt: undefined,
      publishedAt,
    });

    expect(message.isPending()).toBe(false);
    expect(message.publishedAt()?.toISOString()).toBe(publishedAt.toISOString());
  });
});
