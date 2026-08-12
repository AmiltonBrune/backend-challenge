import { describe, expect, it } from 'bun:test';
import { OutboxMessageEntity } from '@infrastructure/persistence/entities/outbox-message.entity.ts';
import { OutboxMessageMapper } from '@infrastructure/persistence/mappers/outbox-message.mapper.ts';

function buildEntity(overrides: Partial<OutboxMessageEntity> = {}): OutboxMessageEntity {
  return {
    id: 'evt-1',
    aggregateId: 'tx-1',
    eventType: 'WagerTransactionProcessed',
    payload: { eventType: 'WagerTransactionProcessed', data: {} },
    occurredAt: new Date('2026-08-12T00:00:00.000Z'),
    attempts: 0,
    nextAttemptAt: null,
    publishedAt: null,
    ...overrides,
  };
}

describe('OutboxMessageMapper.toDomain', () => {
  it('reconstroi os campos persistidos', () => {
    const message = OutboxMessageMapper.toDomain(buildEntity());

    expect(message.id).toBe('evt-1');
    expect(message.eventType).toBe('WagerTransactionProcessed');
    expect(message.attempts()).toBe(0);
    expect(message.isPending()).toBe(true);
  });

  it('reconstroi uma mensagem publicada e com tentativas', () => {
    const publishedAt = new Date('2026-08-12T00:10:00.000Z');
    const entity = buildEntity({ attempts: 4, publishedAt });

    const message = OutboxMessageMapper.toDomain(entity);

    expect(message.attempts()).toBe(4);
    expect(message.isPending()).toBe(false);
    expect(message.publishedAt()?.toISOString()).toBe(publishedAt.toISOString());
  });
});

describe('OutboxMessageMapper.toEntity', () => {
  it('serializa de volta para a forma persistida', () => {
    const message = OutboxMessageMapper.toDomain(buildEntity());

    const entity = OutboxMessageMapper.toEntity(message);

    expect(entity.id).toBe('evt-1');
    expect(entity.aggregateId).toBe('tx-1');
    expect(entity.eventType).toBe('WagerTransactionProcessed');
    expect(entity.attempts).toBe(0);
    expect(entity.nextAttemptAt).toBeNull();
    expect(entity.publishedAt).toBeNull();
  });
});
