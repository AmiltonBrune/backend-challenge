import type { AppConfig } from '@infrastructure/config/app-config.ts';
import { buildSqsClient } from '@infrastructure/messaging/sqs-client-factory.ts';
import { TypeOrmUnitOfWork } from '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts';
import { TypeOrmWalletRepository } from '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts';
import { TypeOrmWagerTransactionRepository } from '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts';
import { TypeOrmLedgerRepository } from '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts';
import { TypeOrmOutboxRepository } from '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts';
import { TypeOrmInboxRepository } from '@infrastructure/persistence/repositories/typeorm-inbox-repository.ts';
import { SystemClock } from '@infrastructure/system-clock.ts';
import { UuidIdGenerator } from '@infrastructure/uuid-id-generator.ts';
import { DeclaredProviderIdentity } from '@infrastructure/declared-provider-identity.ts';
import { PrometheusMetricsAdapter } from '@infrastructure/observability/prometheus-metrics.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { SqsWagerTransactionConsumer } from './sqs-wager-transaction-consumer.ts';

export interface BootstrappedConsumer {
  readonly consumer: SqsWagerTransactionConsumer;
  readonly metrics: MetricsPort;
}

export async function bootstrapConsumer(config: AppConfig): Promise<BootstrappedConsumer> {
  if (config.consumer === undefined) {
    throw new Error('Configuração do consumer ausente.');
  }

  const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const clock = new SystemClock();
  const useCase = new ProcessWagerTransactionUseCase(
    new TypeOrmUnitOfWork(AppDataSource),
    new TypeOrmWalletRepository(clock),
    new TypeOrmWagerTransactionRepository(),
    new TypeOrmLedgerRepository(),
    new TypeOrmOutboxRepository(),
    new TypeOrmInboxRepository(clock),
    new DeclaredProviderIdentity(),
    clock,
    new UuidIdGenerator(),
  );

  const sqsClient = buildSqsClient(config);
  const metrics = new PrometheusMetricsAdapter();

  const consumer = new SqsWagerTransactionConsumer(
    sqsClient,
    config.consumer.queueUrl,
    config.consumer.dlqUrl,
    config.consumer.consumerName,
    useCase,
    {
      maxMessages: config.consumer.maxMessages,
      visibilityTimeoutSeconds: config.consumer.visibilityTimeoutSeconds,
      metrics,
    },
  );

  return { consumer, metrics };
}
