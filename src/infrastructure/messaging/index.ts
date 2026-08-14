export { buildSqsClient } from './sqs-client-factory.ts';
export { ensureWagerQueues } from './ensure-wager-queues.ts';
export type { WagerQueueUrls } from './ensure-wager-queues.ts';
export {
  WAGER_TRANSACTIONS_QUEUE_NAME,
  WAGER_TRANSACTIONS_DLQ_NAME,
  WAGER_EVENTS_QUEUE_NAME,
} from './queue-names.ts';
