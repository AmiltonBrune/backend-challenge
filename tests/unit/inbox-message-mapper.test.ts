import { describe, expect, it } from 'bun:test';
import { InboxMessageEntity } from '@infrastructure/persistence/entities/inbox-message.entity.ts';
import { InboxMessageMapper } from '@infrastructure/persistence/mappers/inbox-message.mapper.ts';

describe('InboxMessageMapper.toDomain', () => {
  it('reconstroi uma mensagem nao processada', () => {
    const entity: InboxMessageEntity = {
      consumerName: 'wager-consumer',
      messageId: 'msg-1',
      payloadHash: 'hash-1',
      receivedAt: new Date('2026-08-12T00:00:00.000Z'),
      processedAt: null,
    };

    const message = InboxMessageMapper.toDomain(entity);

    expect(message.isProcessed()).toBe(false);
    expect(message.messageId).toBe('msg-1');
  });

  it('reconstroi uma mensagem ja processada', () => {
    const processedAt = new Date('2026-08-12T00:01:00.000Z');
    const entity: InboxMessageEntity = {
      consumerName: 'wager-consumer',
      messageId: 'msg-1',
      payloadHash: 'hash-1',
      receivedAt: new Date('2026-08-12T00:00:00.000Z'),
      processedAt,
    };

    const message = InboxMessageMapper.toDomain(entity);

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt()?.toISOString()).toBe(processedAt.toISOString());
  });
});

describe('InboxMessageMapper.toEntity', () => {
  it('serializa de volta, aceitando receivedAt externamente', () => {
    const receivedAt = new Date('2026-08-12T00:00:00.000Z');
    const entity: InboxMessageEntity = {
      consumerName: 'wager-consumer',
      messageId: 'msg-1',
      payloadHash: 'hash-1',
      receivedAt,
      processedAt: null,
    };
    const message = InboxMessageMapper.toDomain(entity);

    const roundTripped = InboxMessageMapper.toEntity(message, receivedAt);

    expect(roundTripped.consumerName).toBe('wager-consumer');
    expect(roundTripped.messageId).toBe('msg-1');
    expect(roundTripped.processedAt).toBeNull();
  });
});
