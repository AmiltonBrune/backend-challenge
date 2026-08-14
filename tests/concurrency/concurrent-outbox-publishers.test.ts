import { afterAll, beforeAll, expect, it } from 'bun:test';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { OutboxPublisherWorker } from '@workers/outbox-publisher/outbox-publisher-worker.ts';
import { ensureWagerQueues } from '@infrastructure/messaging/ensure-wager-queues.ts';
import { ReconcileWalletUseCase } from '@application/use-cases/reconcile-wallet-use-case.ts';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const MESSAGE_COUNT = 20;
const WORKER_COUNT = 3;

interface StartingGate {
  arrive(): Promise<void>;
  readonly allArrived: Promise<void>;
  release(): void;
}

function startingGate(count: number): StartingGate {
  let arrived = 0;
  let resolveAllArrived: () => void = () => {};
  const allArrived = new Promise<void>((resolve) => {
    resolveAllArrived = resolve;
  });
  let resolveGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  return {
    arrive(): Promise<void> {
      arrived += 1;
      if (arrived === count) {
        resolveAllArrived();
      }
      return gate;
    },
    allArrived,
    release: resolveGate,
  };
}

function buildOutboxMessage(walletId: string): OutboxMessage {
  const event = new WalletBalanceChanged({
    eventId: crypto.randomUUID(),
    aggregateId: walletId,
    correlationId: crypto.randomUUID(),
    occurredAt: new Date(),
    data: {
      walletId,
      transactionId: crypto.randomUUID(),
      direction: LedgerDirection.CREDIT,
      money: { amount: '10.00', currency: 'BRL' },
      balanceBefore: { amount: '0.00', currency: 'BRL' },
      balanceAfter: { amount: '10.00', currency: 'BRL' },
      walletVersion: 1,
    },
  });
  return OutboxMessage.enqueue(event);
}

let AppDataSource: DataSource | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

async function insertWallet(balance: string): Promise<string> {
  const rows = await dataSource().query(
    `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', $1, 1, now(), now())
     RETURNING id`,
    [balance],
  );
  return (rows as { id: string }[])[0]!.id;
}

describeIfDocker('T-060 — publishers concorrentes sobre a mesma outbox', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test', 'localstack-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
  }, 60_000);

  afterAll(async () => {
    try {
      if (AppDataSource?.isInitialized === true) {
        await AppDataSource.destroy();
      }
    } finally {
      await runDockerCompose(['down', '-v']);
    }
  }, 30_000);

  it('20 mensagens pendentes, 3 workers em paralelo real: cada mensagem publicada exatamente uma vez', async () => {
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );
    const { TypeOrmWalletRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts'
    );
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );

    const clock: Clock = { now: () => new Date() };
    const unitOfWork: UnitOfWork = new TypeOrmUnitOfWork(dataSource());
    const outboxRepository: OutboxRepository = new TypeOrmOutboxRepository();
    const walletRepository: WalletRepository = new TypeOrmWalletRepository(clock);
    const ledgerRepository: LedgerRepository = new TypeOrmLedgerRepository();

    const walletId = await insertWallet('0.00');

    const messages = Array.from({ length: MESSAGE_COUNT }, () => buildOutboxMessage(walletId));
    await unitOfWork.run(async (ctx) => {
      for (const message of messages) {
        await outboxRepository.insert(ctx, message);
      }
    });
    const messageIds = new Set(messages.map((message) => message.id));

    const sqsClient = new SQSClient({
      endpoint: 'http://localhost:54566',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const { eventsQueueUrl } = await ensureWagerQueues(sqsClient);

    const workers = Array.from(
      { length: WORKER_COUNT },
      () => new OutboxPublisherWorker(sqsClient, eventsQueueUrl, outboxRepository, unitOfWork, clock),
    );

    const gate = startingGate(WORKER_COUNT);
    const runs = workers.map((worker) => gate.arrive().then(() => worker.publishPendingBatch()));

    await gate.allArrived;
    gate.release();
    await Promise.all(runs);

    const rows = await dataSource().query(
      `SELECT id, attempts, published_at FROM outbox_messages WHERE id = ANY($1)`,
      [[...messageIds]],
    );
    const publishedRows = rows as { id: string; attempts: number; published_at: Date | null }[];
    expect(publishedRows).toHaveLength(MESSAGE_COUNT);
    for (const row of publishedRows) {
      expect(row.published_at).not.toBeNull();
      expect(row.attempts).toBe(0);
    }

    const receivedIds: string[] = [];
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 15 && seen.size < MESSAGE_COUNT; attempt += 1) {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({ QueueUrl: eventsQueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }),
      );
      for (const message of response.Messages ?? []) {
        const body = JSON.parse(message.Body ?? '{}') as { eventId: string };
        if (messageIds.has(body.eventId)) {
          receivedIds.push(body.eventId);
          seen.add(body.eventId);
        }
        if (message.ReceiptHandle !== undefined) {
          await sqsClient.send(
            new DeleteMessageCommand({ QueueUrl: eventsQueueUrl, ReceiptHandle: message.ReceiptHandle }),
          );
        }
      }
    }

    expect(receivedIds).toHaveLength(MESSAGE_COUNT);
    expect(seen.size).toBe(MESSAGE_COUNT);

    const reconciliation = await new ReconcileWalletUseCase(
      unitOfWork,
      walletRepository,
      ledgerRepository,
    ).execute({ walletId });
    expect(reconciliation.consistent).toBe(true);
  }, 45_000);
});
