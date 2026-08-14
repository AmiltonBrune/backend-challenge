import type { Clock } from '@application/ports/clock.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { ConcurrentIdempotencyProcessingError } from '@application/errors/concurrent-idempotency-processing-error.ts';
import { IdempotencyKeyConflictError } from '@application/errors/idempotency-key-conflict-error.ts';
import { IdempotencyPayloadConflictError } from '@application/errors/idempotency-payload-conflict-error.ts';
import { BusinessRuleViolationError } from '@domain/errors/business-rule-violation-error.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';
import { InsufficientFundsError } from '@domain/errors/insufficient-funds-error.ts';
import { PlayerWalletMismatchError } from '@domain/errors/player-wallet-mismatch-error.ts';
import { CurrencyMismatchError } from '@domain/errors/currency-mismatch-error.ts';
import { ReferenceAlreadyReversedError } from '@domain/errors/reference-already-reversed-error.ts';
import { ReferenceAmountMismatchError } from '@domain/errors/reference-amount-mismatch-error.ts';
import { ReferenceContextMismatchError } from '@domain/errors/reference-context-mismatch-error.ts';
import { ReferenceKindNotReversibleError } from '@domain/errors/reference-kind-not-reversible-error.ts';
import { ReferenceNotProcessedError } from '@domain/errors/reference-not-processed-error.ts';
import { ReversalWouldOverdrawError } from '@domain/errors/reversal-would-overdraw-error.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import type { IntegrationEvent } from '@domain/events/integration-event.ts';
import { WagerTransactionPendingReference } from '@domain/events/wager-transaction-pending-reference.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import { WagerTransactionRejected } from '@domain/events/wager-transaction-rejected.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { computePayloadHash } from '@domain/idempotency/payload-hash.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import type { MoneyProps } from '@domain/money/money-props.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import type { Wallet } from '@domain/wallet/wallet.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';

const KINDS_REQUIRING_REFERENCE = new Set([
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
]);

const REVERSIBLE_KINDS_BY_KIND: Record<string, ReadonlySet<WagerTransactionKind>> = {
  [WagerTransactionKind.REFUND]: new Set([WagerTransactionKind.BET]),
  [WagerTransactionKind.ROLLBACK]: new Set([
    WagerTransactionKind.BET,
    WagerTransactionKind.WIN,
    WagerTransactionKind.REFUND,
  ]),
};

export interface ProcessWagerTransactionInput {
  readonly declaredProviderId: string;
  readonly idempotencyKey: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly failureCode?: FailureCode;
  readonly balance?: MoneyProps;
  readonly idempotentReplay: boolean;
}

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly walletRepository: WalletRepository,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
    private readonly ledgerRepository: LedgerRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly providerIdentity: ProviderIdentityPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: ProcessWagerTransactionInput): Promise<ProcessWagerTransactionResult> {
    const providerId = this.providerIdentity.resolveProviderId(input.declaredProviderId);
    const money = Money.from(input.money);

    if (input.kind === WagerTransactionKind.OPENING) {
      throw new InternalKindNotAllowedError(input.kind);
    }

    const payloadHash = await computePayloadHash({
      providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: money.toJSON(),
      ...(input.referenceExternalTransactionId !== undefined
        ? { referenceExternalTransactionId: input.referenceExternalTransactionId }
        : {}),
    });

    try {
      return await this.unitOfWork.run((ctx) =>
        this.processInTransaction(ctx, input, providerId, money, payloadHash),
      );
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        return this.resolveReplayOrConflict(providerId, input.idempotencyKey, payloadHash);
      }
      throw error;
    }
  }

  private async processInTransaction(
    ctx: TransactionContext,
    input: ProcessWagerTransactionInput,
    providerId: string,
    money: Money,
    payloadHash: string,
  ): Promise<ProcessWagerTransactionResult> {
    const now = this.clock.now();
    const correlationId = this.idGenerator.generate();
    const transactionId = this.idGenerator.generate();

    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      kind: input.kind,
      money,
      createdAt: now,
      ...(input.referenceExternalTransactionId !== undefined
        ? { referenceExternalTransactionId: input.referenceExternalTransactionId }
        : {}),
    });

    const wallet = await this.walletRepository.findByIdForUpdate(ctx, input.walletId);
    await this.wagerTransactionRepository.insert(ctx, transaction, input.gameId);

    try {
      if (wallet === undefined) {
        throw new WalletNotFoundError(input.walletId);
      }
      if (wallet.playerId !== input.playerId) {
        throw new PlayerWalletMismatchError(input.playerId, input.walletId);
      }
      if (wallet.currency !== money.currency) {
        throw new CurrencyMismatchError(wallet.currency, money.currency);
      }

      let reference: WagerTransaction | undefined;
      if (KINDS_REQUIRING_REFERENCE.has(input.kind)) {
        reference = await this.wagerTransactionRepository.findByProviderAndExternalTransactionId(
          ctx,
          providerId,
          input.referenceExternalTransactionId as string,
        );

        if (reference === undefined) {
          return this.holdPendingReference(ctx, transaction, input, providerId, correlationId, now);
        }

        await this.validateReference(ctx, transaction, reference, money, input);
      }

      const balanceBefore = wallet.balance();
      let entry: WalletLedgerEntry | undefined;

      if (input.kind === WagerTransactionKind.BET) {
        entry = wallet.debit({
          entryId: this.idGenerator.generate(),
          transactionId,
          money,
          createdAt: now,
        });
      } else if (input.kind === WagerTransactionKind.WIN || input.kind === WagerTransactionKind.REFUND) {
        entry = wallet.credit({
          entryId: this.idGenerator.generate(),
          transactionId,
          money,
          createdAt: now,
        });
      } else if (input.kind === WagerTransactionKind.ROLLBACK) {
        const direction = transaction.ledgerDirectionFor(reference);
        entry =
          direction === LedgerDirection.CREDIT
            ? wallet.credit({ entryId: this.idGenerator.generate(), transactionId, money, createdAt: now })
            : this.debitForRollback(wallet, transactionId, money, now);
      }

      if (entry !== undefined) {
        await this.walletRepository.update(ctx, wallet);
        await this.ledgerRepository.insert(ctx, entry);
      }

      transaction.markProcessed(reference?.id, now);
      await this.wagerTransactionRepository.update(ctx, transaction);

      const events: IntegrationEvent<unknown>[] = [
        new WagerTransactionProcessed({
          eventId: this.idGenerator.generate(),
          aggregateId: transactionId,
          correlationId,
          occurredAt: now,
          data: {
            transactionId,
            providerId,
            externalTransactionId: input.externalTransactionId,
            walletId: input.walletId,
            playerId: input.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            kind: input.kind,
            money: money.toJSON(),
            processedAt: now,
            ...(reference !== undefined ? { referenceTransactionId: reference.id } : {}),
            ...(entry !== undefined ? { balanceAfter: wallet.balance().toJSON() } : {}),
          },
        }),
      ];

      if (entry !== undefined) {
        events.push(
          new WalletBalanceChanged({
            eventId: this.idGenerator.generate(),
            aggregateId: input.walletId,
            correlationId,
            occurredAt: now,
            data: {
              walletId: input.walletId,
              transactionId,
              direction: entry.direction,
              money: money.toJSON(),
              balanceBefore: balanceBefore.toJSON(),
              balanceAfter: wallet.balance().toJSON(),
              walletVersion: wallet.version(),
            },
          }),
        );
      }

      for (const event of events) {
        await this.outboxRepository.insert(ctx, OutboxMessage.enqueue(event));
      }

      return {
        transactionId,
        status: WagerTransactionStatus.PROCESSED,
        balance: wallet.balance().toJSON(),
        idempotentReplay: false,
      };
    } catch (error) {
      if (!(error instanceof BusinessRuleViolationError)) {
        throw error;
      }

      transaction.reject(error.failureCode);
      await this.wagerTransactionRepository.update(ctx, transaction);

      const rejectedEvent = new WagerTransactionRejected({
        eventId: this.idGenerator.generate(),
        aggregateId: transactionId,
        correlationId,
        occurredAt: now,
        data: {
          transactionId,
          providerId,
          externalTransactionId: input.externalTransactionId,
          walletId: input.walletId,
          playerId: input.playerId,
          roundId: input.roundId,
          kind: input.kind,
          money: money.toJSON(),
          failureCode: error.failureCode,
          rejectedAt: now,
        },
      });
      await this.outboxRepository.insert(ctx, OutboxMessage.enqueue(rejectedEvent));

      return {
        transactionId,
        status: WagerTransactionStatus.REJECTED,
        failureCode: error.failureCode,
        idempotentReplay: false,
      };
    }
  }

  private debitForRollback(
    wallet: Wallet,
    transactionId: string,
    money: Money,
    now: Date,
  ): WalletLedgerEntry {
    try {
      return wallet.debit({ entryId: this.idGenerator.generate(), transactionId, money, createdAt: now });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ReversalWouldOverdrawError(
          money.toJSON().amount,
          wallet.balance().toJSON().amount,
          wallet.currency,
        );
      }
      throw error;
    }
  }

  private async validateReference(
    ctx: TransactionContext,
    transaction: WagerTransaction,
    reference: WagerTransaction,
    money: Money,
    input: ProcessWagerTransactionInput,
  ): Promise<void> {
    if (reference.status() !== WagerTransactionStatus.PROCESSED) {
      throw new ReferenceNotProcessedError(reference.externalTransactionId, reference.status());
    }

    const reversibleKinds = REVERSIBLE_KINDS_BY_KIND[input.kind];
    if (reversibleKinds === undefined || !reversibleKinds.has(reference.kind)) {
      throw new ReferenceKindNotReversibleError(reference.kind, input.kind);
    }

    if (money.toJSON().amount !== reference.money.toJSON().amount) {
      throw new ReferenceAmountMismatchError(reference.money.toJSON().amount, money.toJSON().amount);
    }

    if (reference.providerId !== transaction.providerId) {
      throw new ReferenceContextMismatchError('providerId');
    }
    if (reference.playerId !== input.playerId) {
      throw new ReferenceContextMismatchError('playerId');
    }
    if (reference.walletId !== input.walletId) {
      throw new ReferenceContextMismatchError('walletId');
    }
    if (reference.money.currency !== money.currency) {
      throw new ReferenceContextMismatchError('currency');
    }
    if (reference.roundId !== input.roundId) {
      throw new ReferenceContextMismatchError('roundId');
    }

    const existingReversal = await this.wagerTransactionRepository.findProcessedReversalByReference(
      ctx,
      reference.id,
      input.kind,
    );
    if (existingReversal !== undefined) {
      throw new ReferenceAlreadyReversedError(reference.externalTransactionId, input.kind);
    }
  }

  private async holdPendingReference(
    ctx: TransactionContext,
    transaction: WagerTransaction,
    input: ProcessWagerTransactionInput,
    providerId: string,
    correlationId: string,
    now: Date,
  ): Promise<ProcessWagerTransactionResult> {
    transaction.markPendingReference();
    await this.wagerTransactionRepository.update(ctx, transaction);

    const pendingEvent = new WagerTransactionPendingReference({
      eventId: this.idGenerator.generate(),
      aggregateId: transaction.id,
      correlationId,
      occurredAt: now,
      data: {
        transactionId: transaction.id,
        providerId,
        externalTransactionId: input.externalTransactionId,
        walletId: input.walletId,
        referenceExternalTransactionId: input.referenceExternalTransactionId as string,
        attempts: 0,
        nextAttemptAt: now,
      },
    });
    await this.outboxRepository.insert(ctx, OutboxMessage.enqueue(pendingEvent));

    return {
      transactionId: transaction.id,
      status: WagerTransactionStatus.PENDING_REFERENCE,
      idempotentReplay: false,
    };
  }

  private async resolveReplayOrConflict(
    providerId: string,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<ProcessWagerTransactionResult> {
    return this.unitOfWork.run(async (ctx) => {
      const existing = await this.wagerTransactionRepository.findByProviderAndIdempotencyKey(
        ctx,
        providerId,
        idempotencyKey,
      );
      if (existing === undefined) {
        throw new IdempotencyKeyConflictError(providerId, idempotencyKey);
      }

      if (existing.payloadHash !== payloadHash) {
        throw new IdempotencyPayloadConflictError(providerId, idempotencyKey);
      }

      if (existing.status() === WagerTransactionStatus.PENDING) {
        throw new ConcurrentIdempotencyProcessingError(providerId, idempotencyKey);
      }

      let balance: MoneyProps | undefined;
      if (existing.status() === WagerTransactionStatus.PROCESSED) {
        const entry = await this.ledgerRepository.findByTransactionId(ctx, existing.id);
        balance = entry?.balanceAfter.toJSON();
      }
      const failureCode = existing.failureCode();

      return {
        transactionId: existing.id,
        status: existing.status(),
        ...(failureCode !== undefined ? { failureCode } : {}),
        ...(balance !== undefined ? { balance } : {}),
        idempotentReplay: true,
      };
    });
  }
}
