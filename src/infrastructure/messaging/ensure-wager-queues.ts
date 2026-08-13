import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueNameExists,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  WAGER_EVENTS_QUEUE_NAME,
  WAGER_TRANSACTIONS_DLQ_NAME,
  WAGER_TRANSACTIONS_QUEUE_NAME,
} from './queue-names.ts';

const MAX_RECEIVE_COUNT = 5;
const VISIBILITY_TIMEOUT_SECONDS = 30;
const RECEIVE_MESSAGE_WAIT_TIME_SECONDS = 20;

export interface WagerQueueUrls {
  readonly transactionsQueueUrl: string;
  readonly dlqUrl: string;
  readonly eventsQueueUrl: string;
}

async function createQueueIdempotent(
  client: SQSClient,
  name: string,
  attributes: Record<string, string>,
): Promise<string> {
  try {
    const result = await client.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
    if (result.QueueUrl === undefined) {
      throw new Error(`SQS não retornou QueueUrl para ${name}.`);
    }
    return result.QueueUrl;
  } catch (error) {
    if (error instanceof QueueNameExists) {
      const existing = await client.send(new GetQueueUrlCommand({ QueueName: name }));
      if (existing.QueueUrl === undefined) {
        throw new Error(`SQS não retornou QueueUrl para ${name} ao consultar fila existente.`, { cause: error });
      }
      return existing.QueueUrl;
    }
    throw error;
  }
}

async function fetchQueueArn(client: SQSClient, queueUrl: string): Promise<string> {
  const result = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
  );
  const arn = result.Attributes?.['QueueArn'];
  if (arn === undefined) {
    throw new Error(`SQS não retornou QueueArn para ${queueUrl}.`);
  }
  return arn;
}

export async function ensureWagerQueues(client: SQSClient): Promise<WagerQueueUrls> {
  const dlqUrl = await createQueueIdempotent(client, WAGER_TRANSACTIONS_DLQ_NAME, {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'false',
  });
  const dlqArn = await fetchQueueArn(client, dlqUrl);

  const transactionsQueueUrl = await createQueueIdempotent(client, WAGER_TRANSACTIONS_QUEUE_NAME, {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'false',
    VisibilityTimeout: String(VISIBILITY_TIMEOUT_SECONDS),
    ReceiveMessageWaitTimeSeconds: String(RECEIVE_MESSAGE_WAIT_TIME_SECONDS),
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: MAX_RECEIVE_COUNT }),
  });

  const eventsQueueUrl = await createQueueIdempotent(client, WAGER_EVENTS_QUEUE_NAME, {});

  return { transactionsQueueUrl, dlqUrl, eventsQueueUrl };
}
