import type { EntityManager } from 'typeorm';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WagerTransactionView } from '@application/dto/wager-transaction-view.ts';
import { ExternalTransactionConflictError } from '@application/errors/external-transaction-conflict-error.ts';
import { IdempotencyKeyConflictError } from '@application/errors/idempotency-key-conflict-error.ts';
import { ReferenceAlreadyReversedError } from '@domain/errors/reference-already-reversed-error.ts';
import type { FailureCode } from '@domain/errors/failure-code.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.ts';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.ts';
import { constraintNameOf } from './unique-violation.ts';

function toView(entity: WagerTransactionEntity): WagerTransactionView {
  return {
    transactionId: entity.id,
    providerId: entity.providerId,
    externalTransactionId: entity.externalTransactionId,
    walletId: entity.walletId,
    playerId: entity.playerId,
    roundId: entity.roundId,
    gameId: entity.gameId,
    kind: entity.kind as WagerTransactionKind,
    money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
    status: entity.status as WagerTransactionStatus,
    failureCode: entity.failureCode as FailureCode | null,
    referenceTransactionId: entity.referenceTransactionId,
    createdAt: entity.createdAt,
    processedAt: entity.processedAt,
  };
}

function translateUniqueViolation(error: unknown, transaction: WagerTransaction): never {
  const constraint = constraintNameOf(error);
  switch (constraint) {
    case 'uq_tx_provider_idempotency':
      throw new IdempotencyKeyConflictError(transaction.providerId, transaction.idempotencyKey);
    case 'uq_tx_provider_external':
      throw new ExternalTransactionConflictError(
        transaction.providerId,
        transaction.externalTransactionId,
      );
    case 'uq_reversal_per_reference':
      throw new ReferenceAlreadyReversedError(
        transaction.referenceExternalTransactionId ?? transaction.externalTransactionId,
        transaction.kind,
      );
    default:
      throw error;
  }
}

export class TypeOrmWagerTransactionRepository implements WagerTransactionRepository {
  async insert(
    ctx: TransactionContext,
    transaction: WagerTransaction,
    gameId: string | null,
  ): Promise<void> {
    const manager = ctx as EntityManager;
    const entity = WagerTransactionMapper.toEntity(transaction, gameId);

    try {
      await manager.insert(WagerTransactionEntity, entity);
    } catch (error) {
      translateUniqueViolation(error, transaction);
    }
  }

  async update(ctx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    const manager = ctx as EntityManager;
    try {
      await manager.update(
        WagerTransactionEntity,
        { id: transaction.id },
        {
          status: transaction.status(),
          failureCode: transaction.failureCode() ?? null,
          referenceTransactionId: transaction.referenceTransactionId() ?? null,
          processedAt: transaction.processedAt() ?? null,
        },
      );
    } catch (error) {
      translateUniqueViolation(error, transaction);
    }
  }

  async findById(ctx: TransactionContext, id: string): Promise<WagerTransaction | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WagerTransactionEntity, { where: { id } });
    return entity === null ? undefined : WagerTransactionMapper.toDomain(entity);
  }

  async findByProviderAndIdempotencyKey(
    ctx: TransactionContext,
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WagerTransactionEntity, {
      where: { providerId, idempotencyKey },
    });
    return entity === null ? undefined : WagerTransactionMapper.toDomain(entity);
  }

  async findByProviderAndExternalTransactionId(
    ctx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WagerTransactionEntity, {
      where: { providerId, externalTransactionId },
    });
    return entity === null ? undefined : WagerTransactionMapper.toDomain(entity);
  }

  async findProcessedReversalByReference(
    ctx: TransactionContext,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WagerTransactionEntity, {
      where: { referenceTransactionId, kind, status: WagerTransactionStatus.PROCESSED },
    });
    return entity === null ? undefined : WagerTransactionMapper.toDomain(entity);
  }

  async findViewById(
    ctx: TransactionContext,
    id: string,
  ): Promise<WagerTransactionView | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WagerTransactionEntity, { where: { id } });
    return entity === null ? undefined : toView(entity);
  }

  async findViewByProviderAndExternalTransactionId(
    ctx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WagerTransactionEntity, {
      where: { providerId, externalTransactionId },
    });
    return entity === null ? undefined : toView(entity);
  }
}
