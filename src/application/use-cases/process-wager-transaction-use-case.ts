import type { Clock } from '@application/ports/clock.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { BusinessRuleViolationError } from '@domain/errors/business-rule-violation-error.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';
import { PlayerWalletMismatchError } from '@domain/errors/player-wallet-mismatch-error.ts';
import { CurrencyMismatchError } from '@domain/errors/currency-mismatch-error.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import type { IntegrationEvent } from '@domain/events/integration-event.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import { WagerTransactionRejected } from '@domain/events/wager-transaction-rejected.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { computePayloadHash } from '@domain/idempotency/payload-hash.ts';
import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import type { MoneyProps } from '@domain/money/money-props.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';

const KINDS_REQUIRING_REFERENCE = new Set([
  WagerTransactionKind.REFUND,
  WagerTransactionKind.ROLLBACK,
]);

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
    if (KINDS_REQUIRING_REFERENCE.has(input.kind)) {
      throw new Error(
        `${input.kind} exige resolução de referência, ainda não suportada por este caso de uso (ver T-035/T-036).`,
      );
    }

    return this.unitOfWork.run(async (ctx) => {
      const now = this.clock.now();
      const correlationId = this.idGenerator.generate();
      const transactionId = this.idGenerator.generate();

      const payloadHash = await computePayloadHash({
        providerId,
        externalTransactionId: input.externalTransactionId,
        playerId: input.playerId,
        walletId: input.walletId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money: money.toJSON(),
      });

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
      });

      await this.wagerTransactionRepository.insert(ctx, transaction, input.gameId);

      try {
        const wallet = await this.walletRepository.findByIdForUpdate(ctx, input.walletId);
        if (wallet === undefined) {
          throw new WalletNotFoundError(input.walletId);
        }
        if (wallet.playerId !== input.playerId) {
          throw new PlayerWalletMismatchError(input.playerId, input.walletId);
        }
        if (wallet.currency !== money.currency) {
          throw new CurrencyMismatchError(wallet.currency, money.currency);
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
        } else if (input.kind === WagerTransactionKind.WIN) {
          entry = wallet.credit({
            entryId: this.idGenerator.generate(),
            transactionId,
            money,
            createdAt: now,
          });
        }

        if (entry !== undefined) {
          await this.walletRepository.update(ctx, wallet);
          await this.ledgerRepository.insert(ctx, entry);
        }

        transaction.markProcessed(undefined, now);
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
        };
      }
    });
  }
}
