import { InboxMessage } from '@domain/messaging/inbox-message.ts';
import type { InboxMessageEntity } from '../entities/inbox-message.entity.ts';

export class InboxMessageMapper {
  static toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      ...(entity.processedAt !== null ? { processedAt: entity.processedAt } : {}),
    });
  }

  static toEntity(message: InboxMessage, receivedAt: Date): InboxMessageEntity {
    return {
      consumerName: message.consumerName,
      messageId: message.messageId,
      payloadHash: message.payloadHash,
      receivedAt,
      processedAt: message.processedAt() ?? null,
    };
  }
}
