import { describe, expect, it } from 'bun:test';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsQueueHealthCheck } from '@infrastructure/health/sqs-queue-health-check.ts';

describe('SqsQueueHealthCheck', () => {
  it('retorna down quando o endpoint SQS está inacessível', async () => {
    const client = new SQSClient({
      endpoint: 'http://127.0.0.1:1',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      maxAttempts: 1,
    });
    const check = new SqsQueueHealthCheck(client, 500);

    expect(await check.check()).toBe('down');
  }, 10_000);
});
