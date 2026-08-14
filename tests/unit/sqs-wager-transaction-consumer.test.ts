import { describe, expect, it } from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import type {
  MetricsPort,
  ProviderMetricInput,
  RejectionMetricInput,
  WagerTransactionMetricInput,
} from '@application/ports/metrics-port.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { getCorrelationId } from '@infrastructure/observability/correlation-context.ts';
import { SqsWagerTransactionConsumer } from '@workers/consumer/sqs-wager-transaction-consumer.ts';

const QUEUE_URL = 'http://localhost:4566/000000000000/wager-transactions.fifo';
const DLQ_URL = 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
const CONSUMER_NAME = 'wagering-consumer';

function validMessageBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    idempotencyKey: 'provider-a:transaction-123',
    providerId: 'provider-a',
    externalTransactionId: 'transaction-123',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-987',
    gameId: 'fortune-chimp',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  });
}

interface RecordedCall {
  readonly command: string;
  readonly input: unknown;
}

function fakeSqsClient(messages: Message[]): { client: SQSClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let served = false;
  const client = {
    send: async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        calls.push({ command: 'ReceiveMessageCommand', input: command.input });
        if (served) {
          return { Messages: [] };
        }
        served = true;
        return { Messages: messages };
      }
      if (command instanceof DeleteMessageCommand) {
        calls.push({ command: 'DeleteMessageCommand', input: command.input });
        return {};
      }
      if (command instanceof SendMessageCommand) {
        calls.push({ command: 'SendMessageCommand', input: command.input });
        return {};
      }
      throw new Error(`comando não esperado: ${String(command)}`);
    },
  } as unknown as SQSClient;

  return { client, calls };
}

function fakeUseCase(execute: (input: unknown, deduplication?: unknown) => Promise<unknown>): ProcessWagerTransactionUseCase {
  return { execute } as unknown as ProcessWagerTransactionUseCase;
}

function buildConsumer(
  client: SQSClient,
  useCase: ProcessWagerTransactionUseCase,
  options?: ConstructorParameters<typeof SqsWagerTransactionConsumer>[5],
): SqsWagerTransactionConsumer {
  return new SqsWagerTransactionConsumer(client, QUEUE_URL, DLQ_URL, CONSUMER_NAME, useCase, options);
}

describe('SqsWagerTransactionConsumer', () => {
  it('recebe com long polling e lote configurados, processa e apaga mensagens processadas com sucesso', async () => {
    const message: Message = {
      MessageId: 'm1',
      ReceiptHandle: 'receipt-1',
      Body: validMessageBody(),
    };
    const { client, calls } = fakeSqsClient([message]);
    const executed: unknown[] = [];
    const useCase = fakeUseCase(async (input) => {
      executed.push(input);
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = buildConsumer(client, useCase, {
      maxMessages: 10,
      waitTimeSeconds: 20,
      visibilityTimeoutSeconds: 30,
    });

    await consumer.receiveAndProcessBatch();

    const receiveCall = calls.find((call) => call.command === 'ReceiveMessageCommand');
    expect((receiveCall?.input as ReceiveMessageCommand['input']).MaxNumberOfMessages).toBe(10);
    expect((receiveCall?.input as ReceiveMessageCommand['input']).WaitTimeSeconds).toBe(20);
    expect((receiveCall?.input as ReceiveMessageCommand['input']).VisibilityTimeout).toBe(30);

    expect(executed).toHaveLength(1);

    const deleteCall = calls.find((call) => call.command === 'DeleteMessageCommand');
    expect((deleteCall?.input as DeleteMessageCommand['input']).ReceiptHandle).toBe('receipt-1');
  });

  it('não apaga a mensagem quando o caso de uso lança um erro transitório, e não encaminha à DLQ', async () => {
    const message: Message = {
      MessageId: 'm1',
      ReceiptHandle: 'receipt-1',
      Body: validMessageBody(),
    };
    const { client, calls } = fakeSqsClient([message]);
    const useCase = fakeUseCase(async () => {
      throw new Error('banco indisponível');
    });

    const consumer = buildConsumer(client, useCase);

    await consumer.receiveAndProcessBatch();

    expect(calls.filter((call) => call.command === 'DeleteMessageCommand')).toHaveLength(0);
    expect(calls.filter((call) => call.command === 'SendMessageCommand')).toHaveLength(0);
  });

  it('processa cada mensagem do lote de forma independente — uma falha não impede o ack das demais', async () => {
    const goodMessage: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-good', Body: validMessageBody() };
    const badMessage: Message = {
      MessageId: 'm2',
      ReceiptHandle: 'receipt-bad',
      Body: validMessageBody({ externalTransactionId: 'transaction-bad' }),
    };
    const { client, calls } = fakeSqsClient([goodMessage, badMessage]);
    const useCase = fakeUseCase(async (input) => {
      const typed = input as { externalTransactionId: string };
      if (typed.externalTransactionId === 'transaction-bad') {
        throw new Error('falha simulada');
      }
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = buildConsumer(client, useCase);

    await consumer.receiveAndProcessBatch();

    const deleteCalls = calls.filter((call) => call.command === 'DeleteMessageCommand');
    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0]?.input as DeleteMessageCommand['input']).ReceiptHandle).toBe('receipt-good');
  });

  it('não faz nada quando o lote vem vazio', async () => {
    const { client, calls } = fakeSqsClient([]);
    const useCase = fakeUseCase(async () => {
      throw new Error('não deveria ser chamado');
    });

    const consumer = buildConsumer(client, useCase);

    await consumer.receiveAndProcessBatch();

    const deleteCalls = calls.filter((call) => call.command === 'DeleteMessageCommand');
    expect(deleteCalls).toHaveLength(0);
  });

  it('processa a mensagem dentro de um contexto de correlationId derivado do MessageId', async () => {
    const message: Message = { MessageId: 'm-correlation-1', ReceiptHandle: 'receipt-1', Body: validMessageBody() };
    const { client } = fakeSqsClient([message]);
    let observedCorrelationId: string | undefined;
    const useCase = fakeUseCase(async () => {
      observedCorrelationId = getCorrelationId();
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = buildConsumer(client, useCase);

    await consumer.receiveAndProcessBatch();

    expect(observedCorrelationId).toBe('m-correlation-1');
  });

  function recordingMetrics(): {
    metrics: MetricsPort;
    transactions: WagerTransactionMetricInput[];
    rejections: RejectionMetricInput[];
    replays: ProviderMetricInput[];
  } {
    const transactions: WagerTransactionMetricInput[] = [];
    const rejections: RejectionMetricInput[] = [];
    const replays: ProviderMetricInput[] = [];
    const metrics: MetricsPort = {
      recordWagerTransaction: (input) => transactions.push(input),
      recordIdempotentReplay: (input) => replays.push(input),
      recordIdempotencyConflict: () => {},
      recordRejection: (input) => rejections.push(input),
      observeHttpRequestDuration: () => {},
      recordOutboxPublish: () => {},
      exposition: async () => ({ contentType: '', body: '' }),
    };
    return { metrics, transactions, rejections, replays };
  }

  it('registra wager_transactions_total quando um MetricsPort é fornecido', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: validMessageBody() };
    const { client } = fakeSqsClient([message]);
    const useCase = fakeUseCase(async () => ({
      transactionId: 't1',
      status: WagerTransactionStatus.PROCESSED,
      idempotentReplay: false,
    }));
    const { metrics, transactions } = recordingMetrics();

    const consumer = buildConsumer(client, useCase, { metrics });

    await consumer.receiveAndProcessBatch();

    expect(transactions).toEqual([{ kind: 'BET', status: 'PROCESSED', provider: 'provider-a' }]);
  });

  it('registra wager_rejections_total quando a transação é rejeitada', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: validMessageBody() };
    const { client } = fakeSqsClient([message]);
    const useCase = fakeUseCase(async () => ({
      transactionId: 't1',
      status: WagerTransactionStatus.REJECTED,
      failureCode: 'INSUFFICIENT_FUNDS',
      idempotentReplay: false,
    }));
    const { metrics, rejections } = recordingMetrics();

    const consumer = buildConsumer(client, useCase, { metrics });

    await consumer.receiveAndProcessBatch();

    expect(rejections).toEqual([{ failureCode: 'INSUFFICIENT_FUNDS' }]);
  });

  it('propaga o messageId e o consumerName ao caso de uso, para deduplicação por inbox', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: validMessageBody() };
    const { client } = fakeSqsClient([message]);
    let receivedDeduplication: unknown;
    const useCase = fakeUseCase(async (_input, deduplication) => {
      receivedDeduplication = deduplication;
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = buildConsumer(client, useCase);
    await consumer.receiveAndProcessBatch();

    expect(receivedDeduplication).toEqual({ messageId: 'm1', consumerName: CONSUMER_NAME });
  });

  it('apaga a mensagem quando o caso de uso identifica uma redelivery já processada via inbox', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: validMessageBody() };
    const { client, calls } = fakeSqsClient([message]);
    const useCase = fakeUseCase(async () => ({ duplicateMessage: true }));

    const consumer = buildConsumer(client, useCase);
    await consumer.receiveAndProcessBatch();

    const deleteCall = calls.find((call) => call.command === 'DeleteMessageCommand');
    expect((deleteCall?.input as DeleteMessageCommand['input']).ReceiptHandle).toBe('receipt-1');
  });

  it('encaminha à DLQ e apaga a mensagem original quando o corpo é malformado (erro permanente)', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: '{ inválido' };
    const { client, calls } = fakeSqsClient([message]);
    let called = false;
    const useCase = fakeUseCase(async () => {
      called = true;
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = buildConsumer(client, useCase);
    await consumer.receiveAndProcessBatch();

    expect(called).toBe(false);

    const dlqCall = calls.find((call) => call.command === 'SendMessageCommand');
    expect((dlqCall?.input as SendMessageCommand['input']).QueueUrl).toBe(DLQ_URL);
    expect((dlqCall?.input as SendMessageCommand['input']).MessageBody).toBe('{ inválido');

    const deleteCall = calls.find((call) => call.command === 'DeleteMessageCommand');
    expect((deleteCall?.input as DeleteMessageCommand['input']).ReceiptHandle).toBe('receipt-1');
  });

  it('encaminha à DLQ e apaga a mensagem original quando o caso de uso rejeita kind interno não permitido', async () => {
    const message: Message = {
      MessageId: 'm1',
      ReceiptHandle: 'receipt-1',
      Body: validMessageBody({ kind: 'OPENING' }),
    };
    const { client, calls } = fakeSqsClient([message]);
    const useCase = fakeUseCase(async () => {
      throw new InternalKindNotAllowedError('OPENING');
    });

    const consumer = buildConsumer(client, useCase);
    await consumer.receiveAndProcessBatch();

    const dlqCall = calls.find((call) => call.command === 'SendMessageCommand');
    expect((dlqCall?.input as SendMessageCommand['input']).QueueUrl).toBe(DLQ_URL);

    const deleteCall = calls.find((call) => call.command === 'DeleteMessageCommand');
    expect((deleteCall?.input as DeleteMessageCommand['input']).ReceiptHandle).toBe('receipt-1');
  });

  it('stop() aguarda o lote em andamento terminar antes de retornar', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: validMessageBody() };
    const { client } = fakeSqsClient([message]);

    let releaseProcessing: () => void = () => {};
    const processingGate = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    let processingStarted = false;
    let resolveStarted: () => void = () => {};
    const startedSignal = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const useCase = fakeUseCase(async () => {
      processingStarted = true;
      resolveStarted();
      await processingGate;
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = buildConsumer(client, useCase);
    consumer.start();
    await startedSignal;
    expect(processingStarted).toBe(true);

    let stopped = false;
    const stopPromise = consumer.stop().then(() => {
      stopped = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);

    releaseProcessing();
    await stopPromise;
    expect(stopped).toBe(true);
  });
});
