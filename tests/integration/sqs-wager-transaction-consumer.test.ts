import { afterAll, beforeAll, expect, it } from 'bun:test';
import { ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { DataSource } from 'typeorm';
import { SqsWagerTransactionConsumer } from '@workers/consumer/sqs-wager-transaction-consumer.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const queueUrl = 'http://localhost:54566/000000000000/wager-transactions.fifo';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

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

    const useCase = new ProcessWagerTransactionUseCase(
      unitOfWork,
      walletRepository,
      wagerTransactionRepository,
      ledgerRepository,
      outboxRepository,
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

    const consumer = new SqsWagerTransactionConsumer(sqsClient, queueUrl, useCase, {
      waitTimeSeconds: 2,
    });
    await consumer.receiveAndProcessBatch();

    const updatedWallet = await unitOfWork.run((ctx) => walletRepository.findById(ctx, wallet.id));
    expect(updatedWallet?.balance().toJSON().amount).toBe('75.00');

    const secondPoll = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    );
    expect(secondPoll.Messages ?? []).toHaveLength(0);
  }, 30_000);
});
