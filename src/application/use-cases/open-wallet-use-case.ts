import type { Clock } from '@application/ports/clock.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import type { IntegrationEvent } from '@domain/events/integration-event.ts';
import { WalletBalanceChanged } from '@domain/events/wallet-balance-changed.ts';
import { WalletOpened } from '@domain/events/wallet-opened.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import type { MoneyProps } from '@domain/money/money-props.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';

const INTERNAL_PROVIDER_ID = 'internal';
const INTERNAL_PAYLOAD_HASH = 'internal-opening';
const INTERNAL_ROUND_ID = 'internal-opening';

export interface OpenWalletInput {
  readonly playerId: string;
  readonly initialBalance: MoneyProps;
}

export interface OpenWalletResult {
  readonly wallet: Wallet;
}

export class OpenWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly walletRepository: WalletRepository,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
    private readonly ledgerRepository: LedgerRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: OpenWalletInput): Promise<OpenWalletResult> {
    const initialBalance = Money.from(input.initialBalance);

    return this.unitOfWork.run(async (ctx) => {
      const now = this.clock.now();
      const correlationId = this.idGenerator.generate();
      const walletId = this.idGenerator.generate();
      const wallet = Wallet.open({
        id: walletId,
        playerId: input.playerId,
        currency: initialBalance.currency,
        initialBalance,
      });

      await this.walletRepository.insert(ctx, wallet);

      const events: IntegrationEvent<unknown>[] = [
        new WalletOpened({
          eventId: this.idGenerator.generate(),
          aggregateId: walletId,
          correlationId,
          occurredAt: now,
          data: {
            walletId,
            playerId: input.playerId,
            currency: initialBalance.currency,
            initialBalance: initialBalance.toJSON(),
            openedAt: now,
          },
        }),
      ];

      if (initialBalance.isPositive()) {
        const transactionId = this.idGenerator.generate();
        const balanceBefore = Money.zero(initialBalance.currency);

        const openingTransaction = WagerTransaction.create({
          id: transactionId,
          providerId: INTERNAL_PROVIDER_ID,
          externalTransactionId: walletId,
          idempotencyKey: walletId,
          payloadHash: INTERNAL_PAYLOAD_HASH,
          walletId,
          playerId: input.playerId,
          roundId: INTERNAL_ROUND_ID,
          kind: WagerTransactionKind.OPENING,
          money: initialBalance,
          createdAt: now,
        });
        openingTransaction.markProcessed(undefined, now);

        const entry = WalletLedgerEntry.create({
          id: this.idGenerator.generate(),
          walletId,
          transactionId,
          direction: LedgerDirection.CREDIT,
          money: initialBalance,
          balanceBefore,
          balanceAfter: initialBalance,
          createdAt: now,
        });

        await this.wagerTransactionRepository.insert(ctx, openingTransaction, null);
        await this.ledgerRepository.insert(ctx, entry);

        events.push(
          new WalletBalanceChanged({
            eventId: this.idGenerator.generate(),
            aggregateId: walletId,
            correlationId,
            occurredAt: now,
            data: {
              walletId,
              transactionId,
              direction: LedgerDirection.CREDIT,
              money: initialBalance.toJSON(),
              balanceBefore: balanceBefore.toJSON(),
              balanceAfter: initialBalance.toJSON(),
              walletVersion: wallet.version(),
            },
          }),
        );
      }

      for (const event of events) {
        await this.outboxRepository.insert(ctx, OutboxMessage.enqueue(event));
      }

      return { wallet };
    });
  }
}
