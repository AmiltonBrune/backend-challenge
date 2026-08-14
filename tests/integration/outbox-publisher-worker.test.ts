import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { DataSource } from 'typeorm';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { OutboxPublisherWorker } from '@workers/outbox-publisher/outbox-publisher-worker.ts';
import { ensureWagerQueues } from '@infrastructure/messaging/ensure-wager-queues.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const composeArgs = ['-f', 'docker-compose.test.yml'] as const;

async function dockerComposeAvailable(): Promise<boolean> {
  try {
    const child = Bun.spawn(['docker', 'compose', 'version'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await child.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function runDockerCompose(args: readonly string[]): Promise<void> {
  const child = Bun.spawn(['docker', 'compose', ...composeArgs, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(`docker compose ${args.join(' ')} falhou: ${stderr}`);
  }
}

const hasDockerCompose = await dockerComposeAvailable();
const describeIfDocker = hasDockerCompose ? describe : describe.skip;

let AppDataSource: DataSource | undefined;

function buildOutboxMessage(occurredAt: Date): OutboxMessage {
  const event = new WalletBalanceChanged({
    eventId: crypto.randomUUID(),
    aggregateId: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    occurredAt,
    data: {
      walletId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      direction: LedgerDirection.CREDIT,
      money: { amount: '50.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '150.00', currency: 'BRL' },
      walletVersion: 2,
    },
  });
  return OutboxMessage.enqueue(event);
}

describeIfDocker('OutboxPublisherWorker — contra Postgres e SQS reais', () => {
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

  it('publica mensagens pendentes na fila wager-events e marca como publicadas no banco', async () => {
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );

    const dataSource = AppDataSource as DataSource;
    const unitOfWork = new TypeOrmUnitOfWork(dataSource);
    const outboxRepository = new TypeOrmOutboxRepository();
    const clock = { now: () => new Date() };

    const sqsClient = new SQSClient({
      endpoint: 'http://localhost:54566',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const { eventsQueueUrl } = await ensureWagerQueues(sqsClient);

    const messageA = buildOutboxMessage(new Date());
    const messageB = buildOutboxMessage(new Date());
    await unitOfWork.run(async (ctx) => {
      await outboxRepository.insert(ctx, messageA);
      await outboxRepository.insert(ctx, messageB);
    });

    const worker = new OutboxPublisherWorker(
      sqsClient,
      eventsQueueUrl,
      outboxRepository,
      unitOfWork,
      clock,
      { batchSize: 50 },
    );

    await worker.publishPendingBatch();

    const receivedIds = new Set<string>();
    for (let attempt = 0; attempt < 5 && receivedIds.size < 2; attempt += 1) {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({ QueueUrl: eventsQueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }),
      );
      for (const message of response.Messages ?? []) {
        const body = JSON.parse(message.Body ?? '{}') as { eventId: string };
        receivedIds.add(body.eventId);
      }
    }

    expect(receivedIds.has(messageA.id)).toBe(true);
    expect(receivedIds.has(messageB.id)).toBe(true);

    const rows = await dataSource.query(
      `SELECT id, published_at FROM outbox_messages WHERE id = ANY($1)`,
      [[messageA.id, messageB.id]],
    );
    const publishedRows = rows as { id: string; published_at: Date | null }[];
    expect(publishedRows).toHaveLength(2);
    expect(publishedRows.every((row) => row.published_at !== null)).toBe(true);
  }, 30_000);

  it('agenda retry sem marcar como publicada quando a fila não existe', async () => {
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );

    const dataSource = AppDataSource as DataSource;
    const unitOfWork = new TypeOrmUnitOfWork(dataSource);
    const outboxRepository = new TypeOrmOutboxRepository();
    const clock = { now: () => new Date() };

    const sqsClient = new SQSClient({
      endpoint: 'http://localhost:54566',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    const message = buildOutboxMessage(new Date());
    await unitOfWork.run((ctx) => outboxRepository.insert(ctx, message));

    const worker = new OutboxPublisherWorker(
      sqsClient,
      'http://localhost:54566/000000000000/fila-inexistente',
      outboxRepository,
      unitOfWork,
      clock,
      { batchSize: 50 },
    );

    await worker.publishPendingBatch();

    const rows = await dataSource.query(
      `SELECT attempts, next_attempt_at, published_at FROM outbox_messages WHERE id = $1`,
      [message.id],
    );
    const row = (rows as { attempts: number; next_attempt_at: Date | null; published_at: Date | null }[])[0];
    expect(row?.attempts).toBe(1);
    expect(row?.next_attempt_at).not.toBeNull();
    expect(row?.published_at).toBeNull();
  }, 30_000);
});
