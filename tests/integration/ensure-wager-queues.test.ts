import { afterAll, beforeAll, expect, it } from 'bun:test';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ensureWagerQueues } from '@infrastructure/messaging/ensure-wager-queues.ts';

import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

let client: SQSClient;

describeIfDocker('ensureWagerQueues — contra LocalStack real', () => {
  beforeAll(async () => {
    await runDockerCompose(['up', '-d', '--wait', 'localstack-test']);
    client = new SQSClient({
      endpoint: 'http://localhost:54566',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
  }, 60_000);

  afterAll(async () => {
    await runDockerCompose(['down', '-v']);
  }, 30_000);

  it('cria (ou reaproveita) as três filas de forma idempotente e com o redrive policy correto', async () => {
    const first = await ensureWagerQueues(client);
    const second = await ensureWagerQueues(client);

    expect(second).toEqual(first);
    expect(first.transactionsQueueUrl).toContain('wager-transactions.fifo');
    expect(first.dlqUrl).toContain('wager-transactions-dlq.fifo');
    expect(first.eventsQueueUrl).toContain('wager-events');

    const attributes = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: first.transactionsQueueUrl,
        AttributeNames: ['RedrivePolicy', 'VisibilityTimeout', 'ReceiveMessageWaitTimeSeconds'],
      }),
    );

    expect(attributes.Attributes?.['VisibilityTimeout']).toBe('30');
    expect(attributes.Attributes?.['ReceiveMessageWaitTimeSeconds']).toBe('20');
    const redrivePolicy = JSON.parse(attributes.Attributes?.['RedrivePolicy'] ?? '{}') as {
      deadLetterTargetArn: string;
      maxReceiveCount: string | number;
    };
    expect(Number(redrivePolicy.maxReceiveCount)).toBe(5);
    expect(redrivePolicy.deadLetterTargetArn).toContain('wager-transactions-dlq.fifo');
  }, 30_000);
});
