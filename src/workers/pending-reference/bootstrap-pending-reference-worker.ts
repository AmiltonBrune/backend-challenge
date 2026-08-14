import type { AppConfig } from '@infrastructure/config/app-config.ts';
import { TypeOrmUnitOfWork } from '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts';
import { TypeOrmWalletRepository } from '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts';
import { TypeOrmWagerTransactionRepository } from '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts';
import { TypeOrmLedgerRepository } from '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts';
import { TypeOrmOutboxRepository } from '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts';
import { SystemClock } from '@infrastructure/system-clock.ts';
import { UuidIdGenerator } from '@infrastructure/uuid-id-generator.ts';
import { DeclaredProviderIdentity } from '@infrastructure/declared-provider-identity.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { PendingReferenceRetryWorker } from './pending-reference-retry-worker.ts';

const PENDING_REFERENCE_BATCH_SIZE = 20;

export async function bootstrapPendingReferenceRetryWorker(
  config: AppConfig,
): Promise<PendingReferenceRetryWorker> {
  if (config.worker === undefined) {
    throw new Error('Configuração do worker ausente.');
  }

  const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const clock = new SystemClock();
  const wagerTransactionRepository = new TypeOrmWagerTransactionRepository();
  const useCase = new ProcessWagerTransactionUseCase(
    new TypeOrmUnitOfWork(AppDataSource),
    new TypeOrmWalletRepository(clock),
    wagerTransactionRepository,
    new TypeOrmLedgerRepository(),
    new TypeOrmOutboxRepository(),
    new DeclaredProviderIdentity(),
    clock,
    new UuidIdGenerator(),
  );

  return new PendingReferenceRetryWorker({
    unitOfWork: new TypeOrmUnitOfWork(AppDataSource),
    wagerTransactionRepository,
    useCase,
    clock,
    batchSize: PENDING_REFERENCE_BATCH_SIZE,
    retryPolicy: {
      maxAttempts: config.worker.pendingReferenceMaxAttempts,
      ttlHours: config.worker.pendingReferenceTtlHours,
    },
  });
}
