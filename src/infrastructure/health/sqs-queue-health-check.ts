import { ListQueuesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { HealthCheckStatus } from '@application/ports/database-health-port.ts';
import type { QueueHealthPort } from '@application/ports/queue-health-port.ts';

const DEFAULT_TIMEOUT_MS = 2000;

export class SqsQueueHealthCheck implements QueueHealthPort {
  constructor(
    private readonly client: SQSClient,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async check(): Promise<HealthCheckStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await this.client.send(new ListQueuesCommand({ MaxResults: 1 }), {
        abortSignal: controller.signal,
      });
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
