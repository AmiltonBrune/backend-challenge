import type { AppConfig } from '@infrastructure/config/app-config.ts';
import { buildSqsClient } from '@infrastructure/messaging/sqs-client-factory.ts';
import { TypeOrmUnitOfWork } from '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts';
import { TypeOrmOutboxRepository } from '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts';
import { SystemClock } from '@infrastructure/system-clock.ts';
import { OutboxPublisherWorker } from './outbox-publisher-worker.ts';

export async function bootstrapOutboxPublisher(config: AppConfig): Promise<OutboxPublisherWorker> {
  if (config.worker === undefined) {
    throw new Error('Configuração do worker ausente.');
  }

  const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const sqsClient = buildSqsClient(config);

  return new OutboxPublisherWorker(
    sqsClient,
    config.worker.eventsQueueUrl,
    new TypeOrmOutboxRepository(),
    new TypeOrmUnitOfWork(AppDataSource),
    new SystemClock(),
    {
      batchSize: config.worker.outboxBatchSize,
      pollIntervalMs: config.worker.outboxPollIntervalMs,
    },
  );
}
