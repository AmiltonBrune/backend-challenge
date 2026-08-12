import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import type { TransactionContext } from './transaction-context.ts';

export interface OutboxRepository {
  insert(ctx: TransactionContext, message: OutboxMessage): Promise<void>;
  reservePending(
    ctx: TransactionContext,
    limit: number,
    now: Date,
  ): Promise<readonly OutboxMessage[]>;
  update(ctx: TransactionContext, message: OutboxMessage): Promise<void>;
}
