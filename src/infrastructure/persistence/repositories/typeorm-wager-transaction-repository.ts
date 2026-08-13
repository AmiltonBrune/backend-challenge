import type { EntityManager } from 'typeorm';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import { ExternalTransactionConflictError } from '@application/errors/external-transaction-conflict-error.ts';
import { IdempotencyKeyConflictError } from '@application/errors/idempotency-key-conflict-error.ts';
import { ReferenceAlreadyReversedError } from '@domain/errors/reference-already-reversed-error.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.ts';
import { WagerTransactionMapper } from '../mappers/wager-transaction.mapper.ts';
import { constraintNameOf } from './unique-violation.ts';

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
  async insert(ctx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    const manager = ctx as EntityManager;
    const entity = WagerTransactionMapper.toEntity(transaction, null);

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
}
