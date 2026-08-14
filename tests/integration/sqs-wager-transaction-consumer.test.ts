import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { DataSource } from 'typeorm';
import { SqsWagerTransactionConsumer } from '@workers/consumer/sqs-wager-transaction-consumer.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const queueUrl = 'http://localhost:54566/000000000000/wager-transactions.fifo';
const dlqUrl = 'http://localhost:54566/000000000000/wager-transactions-dlq.fifo';
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

describeIfDocker('SqsWagerTransactionConsumer — contra Postgres e SQS reais', () => {
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

  it('processa uma mensagem válida da fila, debita a wallet e apaga a mensagem', async () => {
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmWalletRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts'
    );
    const { TypeOrmWagerTransactionRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
    );
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );
    const { TypeOrmInboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-inbox-repository.ts'
    );
    const { DeclaredProviderIdentity } = await import('@infrastructure/declared-provider-identity.ts');
    const { ProcessWagerTransactionUseCase } = await import(
      '@application/use-cases/process-wager-transaction-use-case.ts'
    );
    const { OpenWalletUseCase } = await import('@application/use-cases/open-wallet-use-case.ts');

    const dataSource = AppDataSource as DataSource;
    const clock = { now: () => new Date() };
    const idGenerator = { generate: () => crypto.randomUUID() };
    const unitOfWork = new TypeOrmUnitOfWork(dataSource);
    const walletRepository = new TypeOrmWalletRepository(clock);
    const wagerTransactionRepository = new TypeOrmWagerTransactionRepository();
    const ledgerRepository = new TypeOrmLedgerRepository();
    const outboxRepository = new TypeOrmOutboxRepository();

    const openWallet = new OpenWalletUseCase(
      unitOfWork,
      walletRepository,
      wagerTransactionRepository,
      ledgerRepository,
      outboxRepository,
      clock,
      idGenerator,
    );
    const playerId = crypto.randomUUID();
    const { wallet } = await openWallet.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const inboxRepository = new TypeOrmInboxRepository(clock);

    const useCase = new ProcessWagerTransactionUseCase(
      unitOfWork,
      walletRepository,
      wagerTransactionRepository,
      ledgerRepository,
      outboxRepository,
      inboxRepository,
      new DeclaredProviderIdentity(),
      clock,
      idGenerator,
    );

    const sqsClient = new SQSClient({
      endpoint: 'http://localhost:54566',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    const externalTransactionId = crypto.randomUUID();
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageGroupId: wallet.id,
        MessageDeduplicationId: externalTransactionId,
        MessageBody: JSON.stringify({
          idempotencyKey: `provider-a:${externalTransactionId}`,
          providerId: 'provider-a',
          externalTransactionId,
          playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '25.00', currency: 'BRL' },
        }),
      }),
    );

    const consumer = new SqsWagerTransactionConsumer(
      sqsClient,
      queueUrl,
      dlqUrl,
      'wagering-consumer',
      useCase,
      { waitTimeSeconds: 2 },
    );
    await consumer.receiveAndProcessBatch();

    const updatedWallet = await unitOfWork.run((ctx) => walletRepository.findById(ctx, wallet.id));
    expect(updatedWallet?.balance().toJSON().amount).toBe('75.00');

    const secondPoll = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    );
    expect(secondPoll.Messages ?? []).toHaveLength(0);
  }, 30_000);

  it('encaminha mensagem malformada à DLQ real e apaga da fila original, sem reentrega', async () => {
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmWalletRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts'
    );
    const { TypeOrmWagerTransactionRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
    );
    const { TypeOrmLedgerRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts'
    );
    const { TypeOrmOutboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts'
    );
    const { TypeOrmInboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-inbox-repository.ts'
    );
    const { DeclaredProviderIdentity } = await import('@infrastructure/declared-provider-identity.ts');
    const { ProcessWagerTransactionUseCase } = await import(
      '@application/use-cases/process-wager-transaction-use-case.ts'
    );

    const dataSource = AppDataSource as DataSource;
    const clock = { now: () => new Date() };
    const idGenerator = { generate: () => crypto.randomUUID() };
    const unitOfWork = new TypeOrmUnitOfWork(dataSource);

    const useCase = new ProcessWagerTransactionUseCase(
      unitOfWork,
      new TypeOrmWalletRepository(clock),
      new TypeOrmWagerTransactionRepository(),
      new TypeOrmLedgerRepository(),
      new TypeOrmOutboxRepository(),
      new TypeOrmInboxRepository(clock),
      new DeclaredProviderIdentity(),
      clock,
      idGenerator,
    );

    const sqsClient = new SQSClient({
      endpoint: 'http://localhost:54566',
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    const groupId = crypto.randomUUID();
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageGroupId: groupId,
        MessageDeduplicationId: groupId,
        MessageBody: JSON.stringify({ campoInexistente: true }),
      }),
    );

    const consumer = new SqsWagerTransactionConsumer(
      sqsClient,
      queueUrl,
      dlqUrl,
      'wagering-consumer',
      useCase,
      { waitTimeSeconds: 2 },
    );
    await consumer.receiveAndProcessBatch();

    const originalQueuePoll = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    );
    expect(originalQueuePoll.Messages ?? []).toHaveLength(0);

    const dlqPoll = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: dlqUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 }),
    );
    expect(dlqPoll.Messages ?? []).toHaveLength(1);
    expect(dlqPoll.Messages?.[0]?.Body).toBe(JSON.stringify({ campoInexistente: true }));
  }, 30_000);
});
