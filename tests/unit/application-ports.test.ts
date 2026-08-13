import { describe, expect, it } from 'bun:test';
import { Money } from '@domain/money/money.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { InboxMessage } from '@domain/messaging/inbox-message.ts';
import { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { WagerTransactionProcessed } from '@domain/events/wager-transaction-processed.ts';
import type {
  WalletRepository,
  WagerTransactionRepository,
  LedgerRepository,
  InboxRepository,
  OutboxRepository,
  Clock,
  IdGenerator,
  ProviderIdentityPort,
  TransactionContext,
} from '@application/ports/index.ts';

function buildOutboxMessage(): OutboxMessage {
  const event = new WagerTransactionProcessed({
    eventId: 'evt-1',
    aggregateId: 'tx1',
    correlationId: 'corr-1',
    occurredAt: new Date('2026-08-12T00:00:00.000Z'),
    data: {
      transactionId: 'tx1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      walletId: 'w1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }).toJSON(),
      processedAt: new Date('2026-08-12T00:00:00.000Z'),
    },
  });
  return OutboxMessage.enqueue(event);
}

describe('portas de repositório e serviço — implementabilidade', () => {
  it('WalletRepository e implementavel em memoria', async () => {
    const store = new Map<string, Wallet>();
    const repo: WalletRepository = {
      async findByIdForUpdate(_ctx: TransactionContext, id: string) {
        return store.get(id);
      },
      async findByPlayerAndCurrency(_ctx, playerId, currency) {
        return [...store.values()].find(
          (w) => w.playerId === playerId && w.currency === currency,
        );
      },
      async insert(_ctx, wallet) {
        store.set(wallet.id, wallet);
      },
      async update(_ctx, wallet) {
        store.set(wallet.id, wallet);
      },
    };

    const wallet = Wallet.open({ id: 'w1', playerId: 'p1', currency: 'BRL' });
    await repo.insert(undefined, wallet);

    expect(await repo.findByIdForUpdate(undefined, 'w1')).toBe(wallet);
    expect(await repo.findByPlayerAndCurrency(undefined, 'p1', 'BRL')).toBe(wallet);
  });

  it('WagerTransactionRepository e implementavel em memoria', async () => {
    const store = new Map<string, WagerTransaction>();
    const repo: WagerTransactionRepository = {
      async insert(_ctx, tx) {
        store.set(tx.id, tx);
      },
      async update(_ctx, tx) {
        store.set(tx.id, tx);
      },
      async findById(_ctx, id) {
        return store.get(id);
      },
      async findByProviderAndIdempotencyKey(_ctx, providerId, idempotencyKey) {
        return [...store.values()].find(
          (t) => t.providerId === providerId && t.idempotencyKey === idempotencyKey,
        );
      },
      async findByProviderAndExternalTransactionId(_ctx, providerId, externalTransactionId) {
        return [...store.values()].find(
          (t) => t.providerId === providerId && t.externalTransactionId === externalTransactionId,
        );
      },
      async findProcessedReversalByReference(_ctx, referenceTransactionId, kind) {
        return [...store.values()].find(
          (t) =>
            t.referenceTransactionId() === referenceTransactionId &&
            t.kind === kind &&
            t.status() === WagerTransactionStatus.PROCESSED,
        );
      },
    };

    const tx = WagerTransaction.create({
      id: 'tx1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'idem-1',
      payloadHash: 'hash',
      walletId: 'w1',
      playerId: 'p1',
      roundId: 'round-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date(),
    });
    await repo.insert(undefined, tx, 'game-1');

    expect(await repo.findById(undefined, 'tx1')).toBe(tx);
    expect(await repo.findByProviderAndIdempotencyKey(undefined, 'provider-a', 'idem-1')).toBe(tx);
    expect(
      await repo.findByProviderAndExternalTransactionId(undefined, 'provider-a', 'ext-1'),
    ).toBe(tx);
  });

  it('LedgerRepository e implementavel em memoria', async () => {
    const store: WalletLedgerEntry[] = [];
    const repo: LedgerRepository = {
      async insert(_ctx, entry) {
        store.push(entry);
      },
      async findByTransactionId(_ctx, transactionId) {
        return store.find((e) => e.transactionId === transactionId);
      },
      async sumByWalletId(_ctx, walletId) {
        return store
          .filter((e) => e.walletId === walletId)
          .reduce(
            (acc, e) => (e.direction === LedgerDirection.CREDIT ? acc.add(e.money) : acc.subtract(e.money)),
            Money.zero('BRL'),
          );
      },
    };

    const entry = WalletLedgerEntry.create({
      id: 'e1',
      walletId: 'w1',
      transactionId: 'tx1',
      direction: LedgerDirection.CREDIT,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      balanceBefore: Money.zero('BRL'),
      balanceAfter: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date(),
    });
    await repo.insert(undefined, entry);

    expect(await repo.findByTransactionId(undefined, 'tx1')).toBe(entry);
    expect((await repo.sumByWalletId(undefined, 'w1', 'BRL')).toJSON().amount).toBe('25.00');
  });

  it('InboxRepository e implementavel em memoria', async () => {
    const store = new Set<string>();
    const repo: InboxRepository = {
      async insert(_ctx, message) {
        const key = `${message.consumerName}:${message.messageId}`;
        if (store.has(key)) {
          return 'already-processed';
        }
        store.add(key);
        return 'inserted';
      },
    };

    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-consumer',
      payloadHash: 'hash',
    });

    expect(await repo.insert(undefined, message)).toBe('inserted');
    expect(await repo.insert(undefined, message)).toBe('already-processed');
  });

  it('OutboxRepository e implementavel em memoria', async () => {
    const store = new Map<string, ReturnType<typeof buildOutboxMessage>>();
    const repo: OutboxRepository = {
      async insert(_ctx, message) {
        store.set(message.id, message);
      },
      async reservePending(_ctx, limit, now) {
        return [...store.values()]
          .filter((message) => message.isDue(now))
          .slice(0, limit);
      },
      async update(_ctx, message) {
        store.set(message.id, message);
      },
    };

    const message = buildOutboxMessage();
    await repo.insert(undefined, message);

    const due = await repo.reservePending(undefined, 10, new Date());
    expect(due).toHaveLength(1);
    expect(due[0]).toBe(message);
  });

  it('Clock e implementavel', () => {
    const fixed = new Date('2026-08-12T00:00:00.000Z');
    const clock: Clock = { now: () => fixed };

    expect(clock.now()).toBe(fixed);
  });

  it('IdGenerator e implementavel', () => {
    let counter = 0;
    const generator: IdGenerator = { generate: () => `id-${++counter}` };

    expect(generator.generate()).toBe('id-1');
    expect(generator.generate()).toBe('id-2');
  });

  it('ProviderIdentityPort e implementavel', () => {
    const port: ProviderIdentityPort = {
      resolveProviderId: (declared) => declared,
    };

    expect(port.resolveProviderId('provider-a')).toBe('provider-a');
  });
});
