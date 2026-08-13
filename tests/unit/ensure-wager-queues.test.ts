import { describe, expect, it } from 'bun:test';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueNameExists,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { ensureWagerQueues } from '@infrastructure/messaging/ensure-wager-queues.ts';

interface RecordedCall {
  readonly command: string;
  readonly input: unknown;
}

function fakeSqsClient(
  handlers: Partial<{
    createQueue: (input: CreateQueueCommand['input']) => { QueueUrl?: string };
    getQueueAttributes: (input: GetQueueAttributesCommand['input']) => { Attributes?: Record<string, string> };
    getQueueUrl: (input: GetQueueUrlCommand['input']) => { QueueUrl?: string };
  }>,
): { client: SQSClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    send: async (command: unknown) => {
      if (command instanceof CreateQueueCommand) {
        calls.push({ command: 'CreateQueueCommand', input: command.input });
        if (handlers.createQueue !== undefined) {
          return handlers.createQueue(command.input);
        }
        return { QueueUrl: `http://localhost:4566/000000000000/${command.input.QueueName}` };
      }
      if (command instanceof GetQueueAttributesCommand) {
        calls.push({ command: 'GetQueueAttributesCommand', input: command.input });
        if (handlers.getQueueAttributes !== undefined) {
          return handlers.getQueueAttributes(command.input);
        }
        return { Attributes: { QueueArn: `arn:aws:sqs:us-east-1:000000000000:${command.input.QueueUrl}` } };
      }
      if (command instanceof GetQueueUrlCommand) {
        calls.push({ command: 'GetQueueUrlCommand', input: command.input });
        if (handlers.getQueueUrl !== undefined) {
          return handlers.getQueueUrl(command.input);
        }
        return { QueueUrl: `http://localhost:4566/000000000000/${command.input.QueueName}` };
      }
      throw new Error(`comando não esperado: ${String(command)}`);
    },
  } as unknown as SQSClient;

  return { client, calls };
}

describe('ensureWagerQueues', () => {
  it('cria a DLQ, a fila principal com redrive policy apontando para o ARN da DLQ, e a fila de eventos', async () => {
    const { client, calls } = fakeSqsClient({});

    const result = await ensureWagerQueues(client);

    const createCalls = calls.filter((call) => call.command === 'CreateQueueCommand');
    expect(createCalls).toHaveLength(3);

    const dlqCall = createCalls[0]?.input as CreateQueueCommand['input'];
    expect(dlqCall.QueueName).toBe('wager-transactions-dlq.fifo');
    expect(dlqCall.Attributes).toEqual({ FifoQueue: 'true', ContentBasedDeduplication: 'false' });

    const mainCall = createCalls[1]?.input as CreateQueueCommand['input'];
    expect(mainCall.QueueName).toBe('wager-transactions.fifo');
    expect(mainCall.Attributes?.['VisibilityTimeout']).toBe('30');
    expect(mainCall.Attributes?.['ReceiveMessageWaitTimeSeconds']).toBe('20');
    const redrivePolicy = JSON.parse(mainCall.Attributes?.['RedrivePolicy'] ?? '{}') as {
      deadLetterTargetArn: string;
      maxReceiveCount: number;
    };
    expect(redrivePolicy.maxReceiveCount).toBe(5);
    expect(redrivePolicy.deadLetterTargetArn).toContain('wager-transactions-dlq.fifo');

    const eventsCall = createCalls[2]?.input as CreateQueueCommand['input'];
    expect(eventsCall.QueueName).toBe('wager-events');
    expect(eventsCall.Attributes).toEqual({});

    expect(result.dlqUrl).toContain('wager-transactions-dlq.fifo');
    expect(result.transactionsQueueUrl).toContain('wager-transactions.fifo');
    expect(result.eventsQueueUrl).toContain('wager-events');
  });

  it('reaproveita a URL existente quando a fila já foi criada antes', async () => {
    const { client, calls } = fakeSqsClient({
      createQueue: (input) => {
        if (input.QueueName === 'wager-transactions.fifo') {
          throw new QueueNameExists({ message: 'já existe', $metadata: {} });
        }
        return { QueueUrl: `http://localhost:4566/000000000000/${input.QueueName}` };
      },
    });

    const result = await ensureWagerQueues(client);

    expect(result.transactionsQueueUrl).toBe('http://localhost:4566/000000000000/wager-transactions.fifo');
    const getQueueUrlCalls = calls.filter((call) => call.command === 'GetQueueUrlCommand');
    expect(getQueueUrlCalls).toHaveLength(1);
    expect((getQueueUrlCalls[0]?.input as GetQueueUrlCommand['input']).QueueName).toBe(
      'wager-transactions.fifo',
    );
  });

  it('propaga erros inesperados sem tentar recuperação', async () => {
    const { client } = fakeSqsClient({
      createQueue: () => {
        throw new Error('falha de rede');
      },
    });

    await expect(ensureWagerQueues(client)).rejects.toThrow('falha de rede');
  });
});
