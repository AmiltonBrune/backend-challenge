import type { InboxMessage } from '@domain/messaging/inbox-message.ts';
import type { TransactionContext } from './transaction-context.ts';

export type InboxInsertResult = 'inserted' | 'already-processed';

export interface InboxRepository {
  insert(ctx: TransactionContext, message: InboxMessage): Promise<InboxInsertResult>;
}
