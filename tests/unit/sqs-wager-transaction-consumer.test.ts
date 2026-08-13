import { describe, expect, it } from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { SqsWagerTransactionConsumer } from '@workers/consumer/sqs-wager-transaction-consumer.ts';

const QUEUE_URL = 'http://localhost:4566/000000000000/wager-transactions.fifo';

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
      throw new Error(`comando não esperado: ${String(command)}`);
    },
  } as unknown as SQSClient;

  return { client, calls };
}

function fakeUseCase(
  execute: (input: unknown) => Promise<unknown>,
): ProcessWagerTransactionUseCase {
  return { execute } as unknown as ProcessWagerTransactionUseCase;
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

    const consumer = new SqsWagerTransactionConsumer(client, QUEUE_URL, useCase, {
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

  it('não apaga a mensagem quando o caso de uso lança um erro', async () => {
    const message: Message = {
      MessageId: 'm1',
      ReceiptHandle: 'receipt-1',
      Body: validMessageBody(),
    };
    const { client, calls } = fakeSqsClient([message]);
    const useCase = fakeUseCase(async () => {
      throw new Error('banco indisponível');
    });

    const consumer = new SqsWagerTransactionConsumer(client, QUEUE_URL, useCase);

    await consumer.receiveAndProcessBatch();

    const deleteCalls = calls.filter((call) => call.command === 'DeleteMessageCommand');
    expect(deleteCalls).toHaveLength(0);
  });

  it('não apaga a mensagem quando o corpo é malformado, e não chama o caso de uso', async () => {
    const message: Message = { MessageId: 'm1', ReceiptHandle: 'receipt-1', Body: '{ inválido' };
    const { client, calls } = fakeSqsClient([message]);
    let called = false;
    const useCase = fakeUseCase(async () => {
      called = true;
      return { transactionId: 't1', status: WagerTransactionStatus.PROCESSED, idempotentReplay: false };
    });

    const consumer = new SqsWagerTransactionConsumer(client, QUEUE_URL, useCase);

    await consumer.receiveAndProcessBatch();

    expect(called).toBe(false);
    const deleteCalls = calls.filter((call) => call.command === 'DeleteMessageCommand');
    expect(deleteCalls).toHaveLength(0);
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

    const consumer = new SqsWagerTransactionConsumer(client, QUEUE_URL, useCase);

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

    const consumer = new SqsWagerTransactionConsumer(client, QUEUE_URL, useCase);

    await consumer.receiveAndProcessBatch();

    const deleteCalls = calls.filter((call) => call.command === 'DeleteMessageCommand');
    expect(deleteCalls).toHaveLength(0);
  });
});
