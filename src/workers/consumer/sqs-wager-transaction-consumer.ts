import { randomUUID } from 'node:crypto';
import { DeleteMessageCommand, ReceiveMessageCommand, type Message, type SQSClient } from '@aws-sdk/client-sqs';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { runWithCorrelationId } from '@infrastructure/observability/correlation-context.ts';
import { logger } from '@infrastructure/observability/logger.ts';
import { parseWagerTransactionMessage } from './wager-transaction-message.ts';

const DEFAULT_MAX_MESSAGES = 10;
const DEFAULT_WAIT_TIME_SECONDS = 20;
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 1000;

export interface SqsWagerTransactionConsumerOptions {
  readonly maxMessages?: number;
  readonly waitTimeSeconds?: number;
  readonly visibilityTimeoutSeconds?: number;
  readonly metrics?: MetricsPort;
}

export class SqsWagerTransactionConsumer {
  private readonly maxMessages: number;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeoutSeconds: number;
  private readonly metrics: MetricsPort | undefined;
  private running = false;
  private loopPromise: Promise<void> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly useCase: ProcessWagerTransactionUseCase,
    options: SqsWagerTransactionConsumerOptions = {},
  ) {
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.waitTimeSeconds = options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS;
    this.visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
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
      try {
        await this.receiveAndProcessBatch();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
      }
    }
  }

  async receiveAndProcessBatch(): Promise<void> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.maxMessages,
        WaitTimeSeconds: this.waitTimeSeconds,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
      }),
    );

    const messages = response.Messages ?? [];
    await Promise.allSettled(messages.map((message) => this.processOne(message)));
  }

  private async processOne(message: Message): Promise<void> {
    if (message.Body === undefined || message.ReceiptHandle === undefined) {
      return;
    }

    const correlationId = message.MessageId ?? randomUUID();
    await runWithCorrelationId(correlationId, async () => {
      const input = parseWagerTransactionMessage(message.Body as string);
      const result = await this.useCase.execute(input);

      this.metrics?.recordWagerTransaction({
        kind: input.kind,
        status: result.status,
        provider: input.declaredProviderId,
      });
      if (result.idempotentReplay) {
        this.metrics?.recordIdempotentReplay({ provider: input.declaredProviderId });
      }
      if (result.status === WagerTransactionStatus.REJECTED && result.failureCode !== undefined) {
        this.metrics?.recordRejection({ failureCode: result.failureCode });
      }

      logger.info('mensagem SQS processada', {
        transactionId: result.transactionId,
        kind: input.kind,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });

      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }),
      );
    });
  }
}
