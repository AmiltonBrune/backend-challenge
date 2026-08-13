import { QueryFailedError, type EntityManager } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { InboxInsertResult, InboxRepository } from '@application/ports/inbox-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { InboxMessage } from '@domain/messaging/inbox-message.ts';
import { InboxMessageEntity } from './entities/inbox-message.entity.ts';
import { InboxMessageMapper } from './mappers/inbox-message.mapper.ts';

const UNIQUE_VIOLATION = '23505';

export class TypeOrmInboxRepository implements InboxRepository {
  constructor(private readonly clock: Clock) {}

  async insert(ctx: TransactionContext, message: InboxMessage): Promise<InboxInsertResult> {
    const manager = ctx as EntityManager;
    const entity = InboxMessageMapper.toEntity(message, this.clock.now());

    try {
      await manager.insert(InboxMessageEntity, entity);
      return 'inserted';
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const driverError = error.driverError as { code?: string } | undefined;
        if (driverError?.code === UNIQUE_VIOLATION) {
          return 'already-processed';
        }
      }
      throw error;
    }
  }
}
