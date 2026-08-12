import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import type { IntegrationEventEnvelope } from '@domain/events/integration-event-props.ts';
import type { OutboxMessageEntity } from '../entities/outbox-message.entity.ts';

export class OutboxMessageMapper {
  static toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload as unknown as IntegrationEventEnvelope<unknown>,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt ?? undefined,
      publishedAt: entity.publishedAt ?? undefined,
    });
  }

  static toEntity(message: OutboxMessage): OutboxMessageEntity {
    return {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload as unknown as Record<string, unknown>,
      occurredAt: message.occurredAt,
      attempts: message.attempts(),
      nextAttemptAt: message.nextAttemptAt() ?? null,
      publishedAt: message.publishedAt() ?? null,
    };
  }
}
