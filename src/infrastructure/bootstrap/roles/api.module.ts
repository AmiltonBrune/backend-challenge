import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { TypeOrmUnitOfWork } from '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts';
import { TypeOrmWalletRepository } from '@infrastructure/persistence/repositories/typeorm-wallet-repository.ts';
import { TypeOrmWagerTransactionRepository } from '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts';
import { TypeOrmLedgerRepository } from '@infrastructure/persistence/repositories/typeorm-ledger-repository.ts';
import { TypeOrmOutboxRepository } from '@infrastructure/persistence/repositories/typeorm-outbox-repository.ts';
import { SystemClock } from '@infrastructure/system-clock.ts';
import { UuidIdGenerator } from '@infrastructure/uuid-id-generator.ts';
import { DeclaredProviderIdentity } from '@infrastructure/declared-provider-identity.ts';
import { loadConfig } from '@infrastructure/config/load-config.ts';
import type { AppConfig } from '@infrastructure/config/app-config.ts';
import { TypeOrmDatabaseHealthCheck } from '@infrastructure/health/typeorm-database-health-check.ts';
import { SqsQueueHealthCheck } from '@infrastructure/health/sqs-queue-health-check.ts';
import { buildSqsClient } from '@infrastructure/messaging/sqs-client-factory.ts';
import type { Clock } from '@application/ports/clock.ts';
import type { DatabaseHealthPort } from '@application/ports/database-health-port.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { QueueHealthPort } from '@application/ports/queue-health-port.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { LivenessState } from '@application/health/liveness-state.ts';
import {
  CheckReadinessUseCase,
  GetWagerTransactionUseCase,
  GetWalletUseCase,
  ListWalletLedgerUseCase,
  OpenWalletUseCase,
  ProcessWagerTransactionUseCase,
  ReconcileWalletUseCase,
} from '@application/use-cases/index.ts';
import { WalletsController } from '@interface/http/controllers/wallets.controller.ts';
import { WageringController } from '@interface/http/controllers/wagering.controller.ts';
import { ProvidersController } from '@interface/http/controllers/providers.controller.ts';
import { HealthController } from '@interface/http/controllers/health.controller.ts';
import {
  APP_CONFIG,
  CLOCK,
  DATABASE_HEALTH_CHECK,
  DATA_SOURCE,
  ID_GENERATOR,
  LEDGER_REPOSITORY,
  OUTBOX_REPOSITORY,
  PROVIDER_IDENTITY,
  QUEUE_HEALTH_CHECK,
  UNIT_OF_WORK,
  WAGER_TRANSACTION_REPOSITORY,
  WALLET_REPOSITORY,
} from '../tokens.ts';

@Module({
  controllers: [WalletsController, WageringController, ProvidersController, HealthController],
  providers: [
    {
      provide: DATA_SOURCE,
      useFactory: async (): Promise<DataSource> => {
        const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
        if (!AppDataSource.isInitialized) {
          await AppDataSource.initialize();
        }
        return AppDataSource;
      },
    },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidIdGenerator },
    { provide: PROVIDER_IDENTITY, useClass: DeclaredProviderIdentity },
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env, 'api'),
    },
    {
      provide: DATABASE_HEALTH_CHECK,
      useFactory: (dataSource: DataSource): DatabaseHealthPort => new TypeOrmDatabaseHealthCheck(dataSource),
      inject: [DATA_SOURCE],
    },
    {
      provide: QUEUE_HEALTH_CHECK,
      useFactory: (config: AppConfig): QueueHealthPort => new SqsQueueHealthCheck(buildSqsClient(config)),
      inject: [APP_CONFIG],
    },
    LivenessState,
    {
      provide: CheckReadinessUseCase,
      useFactory: (
        databaseHealth: DatabaseHealthPort,
        queueHealth: QueueHealthPort,
      ): CheckReadinessUseCase => new CheckReadinessUseCase(databaseHealth, queueHealth),
      inject: [DATABASE_HEALTH_CHECK, QUEUE_HEALTH_CHECK],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (dataSource: DataSource): UnitOfWork => new TypeOrmUnitOfWork(dataSource),
      inject: [DATA_SOURCE],
    },
    {
      provide: WALLET_REPOSITORY,
      useFactory: (clock: Clock): WalletRepository => new TypeOrmWalletRepository(clock),
      inject: [CLOCK],
    },
    {
      provide: WAGER_TRANSACTION_REPOSITORY,
      useFactory: (): WagerTransactionRepository => new TypeOrmWagerTransactionRepository(),
    },
    {
      provide: LEDGER_REPOSITORY,
      useFactory: (): LedgerRepository => new TypeOrmLedgerRepository(),
    },
    {
      provide: OUTBOX_REPOSITORY,
      useFactory: (): OutboxRepository => new TypeOrmOutboxRepository(),
    },
    {
      provide: OpenWalletUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        walletRepository: WalletRepository,
        wagerTransactionRepository: WagerTransactionRepository,
        ledgerRepository: LedgerRepository,
        outboxRepository: OutboxRepository,
        clock: Clock,
        idGenerator: IdGenerator,
      ): OpenWalletUseCase =>
        new OpenWalletUseCase(
          unitOfWork,
          walletRepository,
          wagerTransactionRepository,
          ledgerRepository,
          outboxRepository,
          clock,
          idGenerator,
        ),
      inject: [
        UNIT_OF_WORK,
        WALLET_REPOSITORY,
        WAGER_TRANSACTION_REPOSITORY,
        LEDGER_REPOSITORY,
        OUTBOX_REPOSITORY,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ProcessWagerTransactionUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        walletRepository: WalletRepository,
        wagerTransactionRepository: WagerTransactionRepository,
        ledgerRepository: LedgerRepository,
        outboxRepository: OutboxRepository,
        providerIdentity: ProviderIdentityPort,
        clock: Clock,
        idGenerator: IdGenerator,
      ): ProcessWagerTransactionUseCase =>
        new ProcessWagerTransactionUseCase(
          unitOfWork,
          walletRepository,
          wagerTransactionRepository,
          ledgerRepository,
          outboxRepository,
          providerIdentity,
          clock,
          idGenerator,
        ),
      inject: [
        UNIT_OF_WORK,
        WALLET_REPOSITORY,
        WAGER_TRANSACTION_REPOSITORY,
        LEDGER_REPOSITORY,
        OUTBOX_REPOSITORY,
        PROVIDER_IDENTITY,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ReconcileWalletUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        walletRepository: WalletRepository,
        ledgerRepository: LedgerRepository,
      ): ReconcileWalletUseCase => new ReconcileWalletUseCase(unitOfWork, walletRepository, ledgerRepository),
      inject: [UNIT_OF_WORK, WALLET_REPOSITORY, LEDGER_REPOSITORY],
    },
    {
      provide: GetWalletUseCase,
      useFactory: (unitOfWork: UnitOfWork, walletRepository: WalletRepository): GetWalletUseCase =>
        new GetWalletUseCase(unitOfWork, walletRepository),
      inject: [UNIT_OF_WORK, WALLET_REPOSITORY],
    },
    {
      provide: ListWalletLedgerUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        walletRepository: WalletRepository,
        ledgerRepository: LedgerRepository,
      ): ListWalletLedgerUseCase =>
        new ListWalletLedgerUseCase(unitOfWork, walletRepository, ledgerRepository),
      inject: [UNIT_OF_WORK, WALLET_REPOSITORY, LEDGER_REPOSITORY],
    },
    {
      provide: GetWagerTransactionUseCase,
      useFactory: (
        unitOfWork: UnitOfWork,
        wagerTransactionRepository: WagerTransactionRepository,
      ): GetWagerTransactionUseCase =>
        new GetWagerTransactionUseCase(unitOfWork, wagerTransactionRepository),
      inject: [UNIT_OF_WORK, WAGER_TRANSACTION_REPOSITORY],
    },
  ],
})
export class ApiModule implements OnModuleDestroy {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
