import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.ts';
import { OutboxMessageMapper } from '../mappers/outbox-message.mapper.ts';

interface PendingOutboxRow {
  readonly id: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly payload: Record<string, unknown>;
  readonly occurred_at: Date;
  readonly attempts: number;
  readonly next_attempt_at: Date | null;
  readonly published_at: Date | null;
}

function toEntity(row: PendingOutboxRow): OutboxMessageEntity {
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    occurredAt: row.occurred_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    publishedAt: row.published_at,
  };
}

export class TypeOrmOutboxRepository implements OutboxRepository {
  async insert(ctx: TransactionContext, message: OutboxMessage): Promise<void> {
    const manager = ctx as EntityManager;
    const entity = OutboxMessageMapper.toEntity(message) as QueryDeepPartialEntity<OutboxMessageEntity>;
    await manager.insert(OutboxMessageEntity, entity);
  }

  async reservePending(
    ctx: TransactionContext,
    limit: number,
    now: Date,
  ): Promise<readonly OutboxMessage[]> {
    const manager = ctx as EntityManager;
    const rows = await manager.query<PendingOutboxRow[]>(
      `SELECT id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at, published_at
       FROM outbox_messages
       WHERE published_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
       ORDER BY next_attempt_at NULLS FIRST, occurred_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [now, limit],
    );

    return rows.map((row) => OutboxMessageMapper.toDomain(toEntity(row)));
  }

  async update(ctx: TransactionContext, message: OutboxMessage): Promise<void> {
    const manager = ctx as EntityManager;
    await manager.update(
      OutboxMessageEntity,
      { id: message.id },
      {
        attempts: message.attempts(),
        nextAttemptAt: message.nextAttemptAt() ?? null,
        publishedAt: message.publishedAt() ?? null,
      },
    );
  }
}
