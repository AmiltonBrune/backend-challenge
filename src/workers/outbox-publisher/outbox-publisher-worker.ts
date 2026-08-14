import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { Clock } from '@application/ports/clock.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';
import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 500;

export interface OutboxPublisherWorkerOptions {
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly metrics?: MetricsPort;
}

export class OutboxPublisherWorker {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly metrics: MetricsPort | undefined;
  private running = false;
  private loopPromise: Promise<void> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly outboxRepository: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    options: OutboxPublisherWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.metrics = options.metrics;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise !== undefined) {
      await this.loopPromise;
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await this.publishPendingBatch().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  async publishPendingBatch(): Promise<void> {
    await this.unitOfWork.run(async (ctx) => {
      const now = this.clock.now();
      const messages = await this.outboxRepository.reservePending(ctx, this.batchSize, now);
      await Promise.all(messages.map((message) => this.publishOne(message, now)));
      for (const message of messages) {
        await this.outboxRepository.update(ctx, message);
      }
    });
  }

  private async publishOne(message: OutboxMessage, now: Date): Promise<void> {
    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message.payload),
        }),
      );
      message.markPublished(now);
      this.metrics?.recordOutboxPublish({ status: 'published' });
    } catch {
      message.scheduleRetry(now);
      this.metrics?.recordOutboxPublish({ status: 'failed' });
    }
  }
}
