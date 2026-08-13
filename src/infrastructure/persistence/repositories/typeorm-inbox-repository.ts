import type { EntityManager } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { InboxInsertResult, InboxRepository } from '@application/ports/inbox-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { InboxMessage } from '@domain/messaging/inbox-message.ts';
import { InboxMessageEntity } from '../entities/inbox-message.entity.ts';
import { InboxMessageMapper } from '../mappers/inbox-message.mapper.ts';

export class TypeOrmInboxRepository implements InboxRepository {
  constructor(private readonly clock: Clock) {}

  async insert(ctx: TransactionContext, message: InboxMessage): Promise<InboxInsertResult> {
    const manager = ctx as EntityManager;
    const entity = InboxMessageMapper.toEntity(message, this.clock.now());

    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(InboxMessageEntity)
      .values(entity)
      .orIgnore()
      .returning('message_id')
      .execute();

    const raw: unknown = result.raw;
    return Array.isArray(raw) && raw.length > 0 ? 'inserted' : 'already-processed';
  }
}
