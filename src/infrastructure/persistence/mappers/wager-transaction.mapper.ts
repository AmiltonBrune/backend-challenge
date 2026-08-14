import type { FailureCode } from '@domain/errors/failure-code.ts';
import { Money } from '@domain/money/money.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import type { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import type { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import type { WagerTransactionEntity } from '../entities/wager-transaction.entity.ts';

export class WagerTransactionMapper {
  static toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      kind: entity.kind as WagerTransactionKind,
      money: Money.from({ amount: entity.moneyAmount, currency: entity.moneyCurrency }),
      status: entity.status as WagerTransactionStatus,
      createdAt: entity.createdAt,
      pendingReferenceAttempts: entity.pendingReferenceAttempts,
      ...(entity.referenceExternalTransactionId !== null
        ? { referenceExternalTransactionId: entity.referenceExternalTransactionId }
        : {}),
      ...(entity.referenceTransactionId !== null
        ? { referenceTransactionId: entity.referenceTransactionId }
        : {}),
      ...(entity.failureCode !== null
        ? { failureCode: entity.failureCode as FailureCode }
        : {}),
      ...(entity.processedAt !== null ? { processedAt: entity.processedAt } : {}),
      ...(entity.pendingReferenceNextAttemptAt !== null
        ? { pendingReferenceNextAttemptAt: entity.pendingReferenceNextAttemptAt }
        : {}),
    });
  }

  static toEntity(transaction: WagerTransaction, gameId: string | null): WagerTransactionEntity {
    const money = transaction.money.toJSON();

    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId,
      kind: transaction.kind,
      moneyAmount: money.amount,
      moneyCurrency: money.currency,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId: transaction.referenceTransactionId() ?? null,
      status: transaction.status(),
      failureCode: transaction.failureCode() ?? null,
      processedAt: transaction.processedAt() ?? null,
      createdAt: transaction.createdAt,
      pendingReferenceAttempts: transaction.pendingReferenceAttempts(),
      pendingReferenceNextAttemptAt: transaction.pendingReferenceNextAttemptAt() ?? null,
    };
  }
}
