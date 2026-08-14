import { afterAll, beforeAll, expect, it } from 'bun:test';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';
import { SqsWagerTransactionConsumer } from '@workers/consumer/sqs-wager-transaction-consumer.ts';
import { describeIfDocker, runDockerCompose, waitForQueue } from '@tests/support/docker-compose-harness.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const sqsEndpoint = 'http://localhost:54566';
const queueUrl = 'http://localhost:54566/000000000000/wager-transactions.fifo';
const dlqUrl = 'http://localhost:54566/000000000000/wager-transactions-dlq.fifo';
const consumerName = 'wagering-consumer';

let app: INestApplication | undefined;
let baseUrl: string;
let AppDataSource: DataSource | undefined;
let adminSqsClient: SQSClient;

function api(): string {
  return baseUrl;
}

async function openWallet(playerId: string, initialBalance: string): Promise<string> {
  const response = await fetch(`${api()}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: initialBalance, currency: 'BRL' } }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function reconcile(walletId: string): Promise<{ consistent: boolean }> {
  const response = await fetch(`${api()}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  return (await response.json()) as { consistent: boolean };
}

async function pollOnce(client: SQSClient, url: string): Promise<Message | undefined> {
  const result = await client.send(
    new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
  );
  return result.Messages?.[0];
}

describeIfDocker('Retentativa, DLQ e recuperação após reinicialização — contra Postgres e SQS reais', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    process.env['AWS_ENDPOINT_URL'] = sqsEndpoint;
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_ACCESS_KEY_ID'] = 'test';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test', 'localstack-test']);

    adminSqsClient = new SQSClient({
      endpoint: sqsEndpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await waitForQueue(adminSqsClient, 'wager-transactions.fifo');
    await waitForQueue(adminSqsClient, 'wager-transactions-dlq.fifo');

    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const { ApiModule } = await import('@infrastructure/bootstrap/roles/api.module.ts');
    app = await NestFactory.create(ApiModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    try {
      if (app !== undefined) {
        await app.close();
      }
      if (AppDataSource?.isInitialized === true) {
        await AppDataSource.destroy();
      }
    } finally {
      await runDockerCompose(['down', '-v']);
    }
  }, 30_000);

  it(
    'T-061 — esgotadas as tentativas por erro transitório, o SQS move a mensagem para a DLQ real via redrive policy nativo',
    async () => {
      const dlqAttributes = await adminSqsClient.send(
        new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
      );
      const dlqArn = dlqAttributes.Attributes?.['QueueArn'] as string;

      const originalAttributes = await adminSqsClient.send(
        new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['RedrivePolicy'] }),
      );
      const originalRedrivePolicy = originalAttributes.Attributes?.['RedrivePolicy'] as string;

      const reducedMaxReceiveCount = 2;
      await adminSqsClient.send(
        new SetQueueAttributesCommand({
          QueueUrl: queueUrl,
          Attributes: {
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: reducedMaxReceiveCount }),
          },
        }),
      );

      try {
        const playerId = crypto.randomUUID();
        const walletId = await openWallet(playerId, '50.00');

        const alwaysTransientFailureUseCase = {
          execute: async () => {
            throw new Error('banco indisponível');
          },
        } as unknown as ProcessWagerTransactionUseCase;

        const externalTransactionId = crypto.randomUUID();
        await adminSqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageGroupId: walletId,
            MessageDeduplicationId: externalTransactionId,
            MessageBody: JSON.stringify({
              idempotencyKey: `provider-a:${externalTransactionId}`,
              providerId: 'provider-a',
              externalTransactionId,
              playerId,
              walletId,
              roundId: 'round-1',
              gameId: 'game-1',
              kind: 'BET',
              money: { amount: '10.00', currency: 'BRL' },
            }),
          }),
        );

        const consumer = new SqsWagerTransactionConsumer(
          adminSqsClient,
          queueUrl,
          dlqUrl,
          consumerName,
          alwaysTransientFailureUseCase,
          { waitTimeSeconds: 1, visibilityTimeoutSeconds: 1 },
        );

        let dlqMessage: Message | undefined;
        const deadline = Date.now() + 25_000;
        while (dlqMessage === undefined && Date.now() < deadline) {
          await consumer.receiveAndProcessBatch();
          dlqMessage = await pollOnce(adminSqsClient, dlqUrl);
          if (dlqMessage === undefined) {
            await new Promise((resolve) => setTimeout(resolve, 1_200));
          }
        }

        expect(dlqMessage).toBeDefined();
        const dlqBody = JSON.parse(dlqMessage?.Body ?? '{}') as { externalTransactionId: string };
        expect(dlqBody.externalTransactionId).toBe(externalTransactionId);

        const originalQueueMessage = await pollOnce(adminSqsClient, queueUrl);
        expect(originalQueueMessage).toBeUndefined();

        const reconciliation = await reconcile(walletId);
        expect(reconciliation.consistent).toBe(true);
      } finally {
        await adminSqsClient.send(
          new SetQueueAttributesCommand({
            QueueUrl: queueUrl,
            Attributes: { RedrivePolicy: originalRedrivePolicy },
          }),
        );
      }
    },
    45_000,
  );

  it(
    'T-062 — mensagem apagada com falha após o processamento é reentregue e a dedup por inbox evita duplicar o efeito',
    async () => {
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
      const walletRepository = new TypeOrmWalletRepository(clock);
      const wagerTransactionRepository = new TypeOrmWagerTransactionRepository();
      const ledgerRepository = new TypeOrmLedgerRepository();

      const openWalletUseCase = new OpenWalletUseCase(
        new TypeOrmUnitOfWork(dataSource),
        walletRepository,
        wagerTransactionRepository,
        ledgerRepository,
        new TypeOrmOutboxRepository(),
        clock,
        idGenerator,
      );
      const playerId = crypto.randomUUID();
      const { wallet } = await openWalletUseCase.execute({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      });

      const firstUnitOfWork = new TypeOrmUnitOfWork(dataSource);
      const firstProcessUseCase = new ProcessWagerTransactionUseCase(
        firstUnitOfWork,
        new TypeOrmWalletRepository(clock),
        new TypeOrmWagerTransactionRepository(),
        new TypeOrmLedgerRepository(),
        new TypeOrmOutboxRepository(),
        new TypeOrmInboxRepository(clock),
        new DeclaredProviderIdentity(),
        clock,
        idGenerator,
      );

      const externalTransactionId = crypto.randomUUID();
      await adminSqsClient.send(
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
            money: { amount: '30.00', currency: 'BRL' },
          }),
        }),
      );

      let deleteAttempts = 0;
      const dyingAfterAckClient = {
        send: async (command: unknown) => {
          if (command instanceof DeleteMessageCommand) {
            deleteAttempts += 1;
            if (deleteAttempts === 1) {
              throw new Error('processo morreu antes de confirmar o ack');
            }
          }
          return adminSqsClient.send(command as never);
        },
      } as unknown as SQSClient;

      const firstConsumer = new SqsWagerTransactionConsumer(
        dyingAfterAckClient,
        queueUrl,
        dlqUrl,
        consumerName,
        firstProcessUseCase,
        { waitTimeSeconds: 2, visibilityTimeoutSeconds: 2 },
      );
      await firstConsumer.receiveAndProcessBatch();

      expect(deleteAttempts).toBe(1);

      const walletAfterFirstAttempt = await firstUnitOfWork.run((ctx) => walletRepository.findById(ctx, wallet.id));
      expect(walletAfterFirstAttempt?.balance().toJSON().amount).toBe('70.00');

      const transactionAfterFirstAttempt = await firstUnitOfWork.run((ctx) =>
        wagerTransactionRepository.findByProviderAndExternalTransactionId(ctx, 'provider-a', externalTransactionId),
      );
      expect(transactionAfterFirstAttempt?.status()).toBe(WagerTransactionStatus.PROCESSED);

      await new Promise((resolve) => setTimeout(resolve, 2_500));

      const secondUnitOfWork = new TypeOrmUnitOfWork(dataSource);
      const secondProcessUseCase = new ProcessWagerTransactionUseCase(
        secondUnitOfWork,
        new TypeOrmWalletRepository(clock),
        new TypeOrmWagerTransactionRepository(),
        new TypeOrmLedgerRepository(),
        new TypeOrmOutboxRepository(),
        new TypeOrmInboxRepository(clock),
        new DeclaredProviderIdentity(),
        clock,
        idGenerator,
      );
      const secondAttemptResults: unknown[] = [];
      const secondUseCaseSpy = {
        execute: async (input: unknown, deduplication: unknown) => {
          const result = await secondProcessUseCase.execute(input as never, deduplication as never);
          secondAttemptResults.push(result);
          return result;
        },
      } as unknown as ProcessWagerTransactionUseCase;

      const secondConsumer = new SqsWagerTransactionConsumer(
        adminSqsClient,
        queueUrl,
        dlqUrl,
        consumerName,
        secondUseCaseSpy,
        { waitTimeSeconds: 2, visibilityTimeoutSeconds: 2 },
      );
      await secondConsumer.receiveAndProcessBatch();

      expect(secondAttemptResults).toEqual([{ duplicateMessage: true }]);

      const walletAfterRedelivery = await secondUnitOfWork.run((ctx) => walletRepository.findById(ctx, wallet.id));
      expect(walletAfterRedelivery?.balance().toJSON().amount).toBe('70.00');

      const ledgerEntryCount = await secondUnitOfWork.run((ctx) =>
        ledgerRepository.countByWalletId(ctx, wallet.id),
      );
      expect(ledgerEntryCount).toBe(2);

      const remainingMessage = await pollOnce(adminSqsClient, queueUrl);
      expect(remainingMessage).toBeUndefined();

      const reconciliation = await reconcile(wallet.id);
      expect(reconciliation.consistent).toBe(true);
    },
    45_000,
  );
});
