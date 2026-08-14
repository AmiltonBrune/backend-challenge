import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';
import { InvalidQueueMessageError } from './invalid-queue-message-error.ts';
import { parseWagerTransactionMessage } from './wager-transaction-message.ts';

const DEFAULT_MAX_MESSAGES = 10;
const DEFAULT_WAIT_TIME_SECONDS = 20;
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 1000;

export interface SqsWagerTransactionConsumerOptions {
  readonly maxMessages?: number;
  readonly waitTimeSeconds?: number;
  readonly visibilityTimeoutSeconds?: number;
}

export class SqsWagerTransactionConsumer {
  private readonly maxMessages: number;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeoutSeconds: number;
  private running = false;
  private loopPromise: Promise<void> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly dlqUrl: string,
    private readonly consumerName: string,
    private readonly useCase: ProcessWagerTransactionUseCase,
    options: SqsWagerTransactionConsumerOptions = {},
  ) {
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.waitTimeSeconds = options.waitTimeSeconds ?? DEFAULT_WAIT_TIME_SECONDS;
    this.visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
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
    const { Body: body, ReceiptHandle: receiptHandle, MessageId: messageId } = message;
    if (body === undefined || receiptHandle === undefined || messageId === undefined) {
      return;
    }

    try {
      const input = parseWagerTransactionMessage(body);
      await this.useCase.execute(input, { messageId, consumerName: this.consumerName });
    } catch (error) {
      if (error instanceof InvalidQueueMessageError || error instanceof InternalKindNotAllowedError) {
        await this.forwardToDlq(body, messageId);
        await this.deleteMessage(receiptHandle);
        return;
      }
      throw error;
    }

    await this.deleteMessage(receiptHandle);
  }

  private async forwardToDlq(body: string, messageId: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: body,
        MessageGroupId: messageId,
        MessageDeduplicationId: messageId,
      }),
    );
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }));
  }
}
