import { describe, expect, it } from 'bun:test';
import { InboxMessage } from '@domain/messaging/inbox-message.ts';

describe('InboxMessage.receive', () => {
  it('cria nao processada', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
    });

    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt()).toBeUndefined();
    expect(message.messageId).toBe('msg-1');
    expect(message.consumerName).toBe('wager-consumer');
  });
});

describe('InboxMessage.markProcessed', () => {
  it('marca como processada com a data informada', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
    });
    const at = new Date('2026-08-12T00:00:00.000Z');

    message.markProcessed(at);

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt()?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('copia a Date recebida — mutar o original nao afeta a mensagem', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
    });
    const at = new Date('2026-08-12T00:00:00.000Z');
    message.markProcessed(at);

    at.setFullYear(1999);

    expect(message.processedAt()?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('nao expoe a Date interna por referencia', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
    });
    message.markProcessed(new Date('2026-08-12T00:00:00.000Z'));

    message.processedAt()?.setFullYear(1999);

    expect(message.processedAt()?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });
});

describe('InboxMessage.rehydrate', () => {
  it('reconstroi uma mensagem nao processada', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
    });

    expect(message.isProcessed()).toBe(false);
  });

  it('reconstroi uma mensagem ja processada com o processedAt persistido', () => {
    const processedAt = new Date('2026-08-12T00:00:00.000Z');
    const message = InboxMessage.rehydrate({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-1',
      processedAt,
    });

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt()?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });
});
