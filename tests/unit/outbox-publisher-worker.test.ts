import { describe, expect, it } from 'bun:test';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { Clock } from '@application/ports/clock.ts';
import { Money } from '@domain/money/money.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { OutboxPublisherWorker } from '@workers/outbox-publisher/outbox-publisher-worker.ts';

const QUEUE_URL = 'http://localhost:4566/000000000000/wager-events';

function buildMessage(id: string, occurredAt: Date): OutboxMessage {
  const event = new WagerTransactionProcessed({
    eventId: id,
    aggregateId: `tx-${id}`,
    correlationId: `corr-${id}`,
    occurredAt,
    data: {
      transactionId: `tx-${id}`,
      providerId: 'provider-a',
      externalTransactionId: `ext-${id}`,
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
      processedAt: occurredAt,
    },
  });
  return OutboxMessage.enqueue(event);
}

interface RecordedCall {
  readonly command: string;
  readonly input: unknown;
}

function fakeSqsClient(
  handler: (input: SendMessageCommand['input']) => Promise<Record<string, unknown>>,
): { client: SQSClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    send: async (command: unknown) => {
      if (command instanceof SendMessageCommand) {
        calls.push({ command: 'SendMessageCommand', input: command.input });
        return handler(command.input);
      }
      throw new Error(`comando não esperado: ${String(command)}`);
    },
  } as unknown as SQSClient;

  return { client, calls };
}

function fakeUnitOfWork(): UnitOfWork {
  return {
    run: async (work) => work({} as TransactionContext),
  };
}

function fakeOutboxRepository(initial: OutboxMessage[]): OutboxRepository & { updated: OutboxMessage[] } {
  const store = new Map(initial.map((message) => [message.id, message]));
  const updated: OutboxMessage[] = [];
  return {
    updated,
    insert: async (_ctx, message) => {
      store.set(message.id, message);
    },
    reservePending: async (_ctx, limit, now) => {
      return [...store.values()].filter((message) => message.isDue(now)).slice(0, limit);
    },
    update: async (_ctx, message) => {
      store.set(message.id, message);
      updated.push(message);
    },
  };
}

function fakeClock(now: Date): Clock {
  return { now: () => now };
}

describe('OutboxPublisherWorker', () => {
  it('publica cada mensagem pendente na fila wager-events e marca como publicada', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const messageA = buildMessage('evt-a', now);
    const messageB = buildMessage('evt-b', now);
    const outboxRepository = fakeOutboxRepository([messageA, messageB]);
    const { client, calls } = fakeSqsClient(async () => ({ MessageId: 'sqs-1' }));
    const worker = new OutboxPublisherWorker(
      client,
      QUEUE_URL,
      outboxRepository,
      fakeUnitOfWork(),
      fakeClock(now),
      { batchSize: 50 },
    );

    await worker.publishPendingBatch();

    expect(calls).toHaveLength(2);
    const bodies = calls.map((call) => JSON.parse((call.input as SendMessageCommand['input']).MessageBody ?? '{}'));
    expect(bodies.map((body) => body.eventId).sort()).toEqual(['evt-a', 'evt-b']);
    expect((calls[0]?.input as SendMessageCommand['input']).QueueUrl).toBe(QUEUE_URL);

    expect(outboxRepository.updated).toHaveLength(2);
    expect(outboxRepository.updated.every((message) => message.isPending() === false)).toBe(true);
  });

  it('não publica quando o lote reservado vem vazio', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const outboxRepository = fakeOutboxRepository([]);
    const { client, calls } = fakeSqsClient(async () => ({ MessageId: 'sqs-1' }));
    const worker = new OutboxPublisherWorker(client, QUEUE_URL, outboxRepository, fakeUnitOfWork(), fakeClock(now));

    await worker.publishPendingBatch();

    expect(calls).toHaveLength(0);
  });

  it('agenda retry com backoff e não marca como publicada quando o SQS falha', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const message = buildMessage('evt-fail', now);
    const outboxRepository = fakeOutboxRepository([message]);
    const { client } = fakeSqsClient(async () => {
      throw new Error('fila indisponível');
    });
    const worker = new OutboxPublisherWorker(client, QUEUE_URL, outboxRepository, fakeUnitOfWork(), fakeClock(now));

    await worker.publishPendingBatch();

    expect(outboxRepository.updated).toHaveLength(1);
    const updated = outboxRepository.updated[0];
    expect(updated?.isPending()).toBe(true);
    expect(updated?.attempts()).toBe(1);
    expect(updated?.nextAttemptAt()).toBeDefined();
  });

  it('processa cada mensagem do lote de forma independente — uma falha não impede a publicação das demais', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const goodMessage = buildMessage('evt-good', now);
    const badMessage = buildMessage('evt-bad', now);
    const outboxRepository = fakeOutboxRepository([goodMessage, badMessage]);
    const { client } = fakeSqsClient(async (input) => {
      const body = JSON.parse(input.MessageBody ?? '{}') as { eventId: string };
      if (body.eventId === 'evt-bad') {
        throw new Error('falha simulada');
      }
      return { MessageId: 'sqs-1' };
    });
    const worker = new OutboxPublisherWorker(client, QUEUE_URL, outboxRepository, fakeUnitOfWork(), fakeClock(now));

    await worker.publishPendingBatch();

    const good = outboxRepository.updated.find((message) => message.id === 'evt-good');
    const bad = outboxRepository.updated.find((message) => message.id === 'evt-bad');
    expect(good?.isPending()).toBe(false);
    expect(bad?.isPending()).toBe(true);
    expect(bad?.attempts()).toBe(1);
  });

  it('respeita o batchSize configurado ao reservar mensagens', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const messages = [buildMessage('evt-1', now), buildMessage('evt-2', now), buildMessage('evt-3', now)];
    const outboxRepository = fakeOutboxRepository(messages);
    const { calls, client } = fakeSqsClient(async () => ({ MessageId: 'sqs-1' }));
    const worker = new OutboxPublisherWorker(client, QUEUE_URL, outboxRepository, fakeUnitOfWork(), fakeClock(now), {
      batchSize: 1,
    });

    await worker.publishPendingBatch();

    expect(calls).toHaveLength(1);
  });

  it('publica as mensagens do lote em paralelo, não uma por vez', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const messages = Array.from({ length: 5 }, (_, index) => buildMessage(`evt-${index}`, now));
    const outboxRepository = fakeOutboxRepository(messages);
    let inFlight = 0;
    let maxInFlight = 0;
    const { client } = fakeSqsClient(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { MessageId: 'sqs-1' };
    });
    const worker = new OutboxPublisherWorker(client, QUEUE_URL, outboxRepository, fakeUnitOfWork(), fakeClock(now), {
      batchSize: 50,
    });

    await worker.publishPendingBatch();

    expect(maxInFlight).toBeGreaterThan(1);
    expect(outboxRepository.updated).toHaveLength(5);
  });

  it('inicia e para o loop de polling sem lançar erro', async () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const outboxRepository = fakeOutboxRepository([]);
    const { client } = fakeSqsClient(async () => ({ MessageId: 'sqs-1' }));
    const worker = new OutboxPublisherWorker(client, QUEUE_URL, outboxRepository, fakeUnitOfWork(), fakeClock(now), {
      pollIntervalMs: 5,
    });

    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await worker.stop();

    expect(true).toBe(true);
  });
});
