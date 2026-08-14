import { describe, expect, it } from 'bun:test';
import type { Clock } from '@application/ports/clock.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { InboxInsertResult, InboxRepository } from '@application/ports/inbox-repository.ts';
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
import { FailureCode } from '@domain/errors/failure-code.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';
import { computePayloadHash } from '@domain/idempotency/payload-hash.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import type { InboxMessage } from '@domain/messaging/inbox-message.ts';
import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  generate(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

class NoopUnitOfWork implements UnitOfWork {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

class DeclaredIdentity implements ProviderIdentityPort {
  resolveProviderId(declared: string): string {
    return declared;
  }
}

class InMemoryWalletRepository implements WalletRepository {
  readonly store = new Map<string, Wallet>();

  seed(wallet: Wallet): void {
    this.store.set(wallet.id, wallet);
  }

  async findById(_ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    return this.store.get(id);
  }

  async findByIdForUpdate(_ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    return this.store.get(id);
  }

  async findByPlayerAndCurrency(): Promise<Wallet | undefined> {
    return undefined;
  }

  async findViewById() {
    return undefined;
  }

  async insert(_ctx: TransactionContext, wallet: Wallet): Promise<void> {
    this.store.set(wallet.id, wallet);
  }

  async update(_ctx: TransactionContext, wallet: Wallet): Promise<void> {
    this.store.set(wallet.id, wallet);
  }
}

class InMemoryWagerTransactionRepository implements WagerTransactionRepository {
  readonly store = new Map<string, WagerTransaction>();

  async insert(_ctx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    const collision = [...this.store.values()].find(
      (t) => t.providerId === transaction.providerId && t.idempotencyKey === transaction.idempotencyKey,
    );
    if (collision !== undefined) {
      throw new IdempotencyKeyConflictError(transaction.providerId, transaction.idempotencyKey);
    }
    this.store.set(transaction.id, transaction);
  }

  async update(_ctx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    this.store.set(transaction.id, transaction);
  }

  async findById(_ctx: TransactionContext, id: string): Promise<WagerTransaction | undefined> {
    return this.store.get(id);
  }

  async findByProviderAndIdempotencyKey(
    _ctx: TransactionContext,
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined> {
    return [...this.store.values()].find(
      (t) => t.providerId === providerId && t.idempotencyKey === idempotencyKey,
    );
  }

  async findByProviderAndExternalTransactionId(
    _ctx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    return [...this.store.values()].find(
      (t) => t.providerId === providerId && t.externalTransactionId === externalTransactionId,
    );
  }

  async findProcessedReversalByReference(
    _ctx: TransactionContext,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | undefined> {
    return [...this.store.values()].find(
      (t) =>
        t.referenceTransactionId() === referenceTransactionId &&
        t.kind === kind &&
        t.status() === WagerTransactionStatus.PROCESSED,
    );
  }

  async findViewById() {
    return undefined;
  }

  async findViewByProviderAndExternalTransactionId() {
    return undefined;
  }
}

class InMemoryLedgerRepository implements LedgerRepository {
  readonly store: WalletLedgerEntry[] = [];

  async insert(_ctx: TransactionContext, entry: WalletLedgerEntry): Promise<void> {
    this.store.push(entry);
  }

  async findByTransactionId(
    _ctx: TransactionContext,
    transactionId: string,
  ): Promise<WalletLedgerEntry | undefined> {
    return this.store.find((e) => e.transactionId === transactionId);
  }

  async countByWalletId(): Promise<number> {
    return this.store.length;
  }

  async sumByWalletId(): Promise<never> {
    throw new Error('não usado neste teste');
  }

  async findPageByWalletId() {
    return { entries: [], hasMore: false, nextCursor: undefined };
  }
}

class InMemoryOutboxRepository implements OutboxRepository {
  readonly store: OutboxMessage[] = [];

  async insert(_ctx: TransactionContext, message: OutboxMessage): Promise<void> {
    this.store.push(message);
  }

  async reservePending(): Promise<readonly OutboxMessage[]> {
    return [];
  }

  async update(): Promise<void> {}
}

class InMemoryInboxRepository implements InboxRepository {
  readonly seen = new Set<string>();
  readonly calls: { messageId: string; consumerName: string; payloadHash: string }[] = [];

  async insert(_ctx: TransactionContext, message: InboxMessage): Promise<InboxInsertResult> {
    const key = `${message.consumerName}:${message.messageId}`;
    this.calls.push({
      messageId: message.messageId,
      consumerName: message.consumerName,
      payloadHash: message.payloadHash,
    });
    if (this.seen.has(key)) {
      return 'already-processed';
    }
    this.seen.add(key);
    return 'inserted';
  }
}

function buildUseCase() {
  const walletRepository = new InMemoryWalletRepository();
  const wagerTransactionRepository = new InMemoryWagerTransactionRepository();
  const ledgerRepository = new InMemoryLedgerRepository();
  const outboxRepository = new InMemoryOutboxRepository();
  const inboxRepository = new InMemoryInboxRepository();
  const clock = new FixedClock(new Date('2026-08-13T00:00:00.000Z'));
  const idGenerator = new SequentialIdGenerator();

  const useCase = new ProcessWagerTransactionUseCase(
    new NoopUnitOfWork(),
    walletRepository,
    wagerTransactionRepository,
    ledgerRepository,
    outboxRepository,
    inboxRepository,
    new DeclaredIdentity(),
    clock,
    idGenerator,
  );

  return {
    useCase,
    walletRepository,
    wagerTransactionRepository,
    ledgerRepository,
    outboxRepository,
    inboxRepository,
  };
}

function baseInput(overrides: Partial<Parameters<ProcessWagerTransactionUseCase['execute']>[0]> = {}) {
  return {
    declaredProviderId: 'provider-a',
    idempotencyKey: 'idem-1',
    externalTransactionId: 'ext-1',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.BET,
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  };
}

describe('ProcessWagerTransactionUseCase — BET', () => {
  it('debita a wallet e processa quando há saldo suficiente', async () => {
    const { useCase, walletRepository, ledgerRepository, outboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(baseInput());

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('75.00');

    const wallet = walletRepository.store.get('wallet-1');
    expect(wallet?.balance().toJSON().amount).toBe('75.00');

    expect(ledgerRepository.store).toHaveLength(1);
    expect(ledgerRepository.store[0]?.direction).toBe(LedgerDirection.DEBIT);

    expect(outboxRepository.store).toHaveLength(2);
    expect(outboxRepository.store[0]?.eventType).toBe('WagerTransactionProcessed');
    expect(outboxRepository.store[1]?.eventType).toBe('WalletBalanceChanged');
    expect(outboxRepository.store[0]?.payload.correlationId).toBe(
      outboxRepository.store[1]?.payload.correlationId,
    );
  });

  it('rejeita com INSUFFICIENT_FUNDS sem alterar a wallet, mas persiste a transação', async () => {
    const { useCase, walletRepository, wagerTransactionRepository, ledgerRepository, outboxRepository } =
      buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '10.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(baseInput());

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(result.balance).toBeUndefined();

    const wallet = walletRepository.store.get('wallet-1');
    expect(wallet?.balance().toJSON().amount).toBe('10.00');
    expect(wallet?.version()).toBe(1);

    expect(ledgerRepository.store).toHaveLength(0);

    const persisted = [...wagerTransactionRepository.store.values()][0];
    expect(persisted?.status()).toBe(WagerTransactionStatus.REJECTED);
    expect(persisted?.failureCode()).toBe(FailureCode.INSUFFICIENT_FUNDS);

    expect(outboxRepository.store).toHaveLength(1);
    expect(outboxRepository.store[0]?.eventType).toBe('WagerTransactionRejected');
  });
});

describe('ProcessWagerTransactionUseCase — WIN', () => {
  it('credita a wallet e processa', async () => {
    const { useCase, walletRepository, ledgerRepository, outboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.WIN, money: { amount: '50.00', currency: 'BRL' } }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('150.00');
    expect(ledgerRepository.store[0]?.direction).toBe(LedgerDirection.CREDIT);
    expect(outboxRepository.store).toHaveLength(2);
  });
});

describe('ProcessWagerTransactionUseCase — LOSS', () => {
  it('processa sem mover saldo, sem lançamento e sem WalletBalanceChanged', async () => {
    const { useCase, walletRepository, ledgerRepository, outboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.LOSS, money: { amount: '25.00', currency: 'BRL' } }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('100.00');

    const wallet = walletRepository.store.get('wallet-1');
    expect(wallet?.version()).toBe(1);
    expect(ledgerRepository.store).toHaveLength(0);

    expect(outboxRepository.store).toHaveLength(1);
    expect(outboxRepository.store[0]?.eventType).toBe('WagerTransactionProcessed');
  });
});

describe('ProcessWagerTransactionUseCase — validações', () => {
  it('rejeita WALLET_NOT_FOUND quando a wallet não existe, e ainda assim persiste a transação', async () => {
    const { useCase, wagerTransactionRepository, outboxRepository } = buildUseCase();

    const result = await useCase.execute(baseInput());

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.WALLET_NOT_FOUND);
    expect(wagerTransactionRepository.store.size).toBe(1);
    expect(outboxRepository.store).toHaveLength(1);
  });

  it('rejeita PLAYER_WALLET_MISMATCH quando o playerId não é titular da wallet', async () => {
    const { useCase, walletRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'outro-jogador',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(baseInput());

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.PLAYER_WALLET_MISMATCH);
  });

  it('rejeita CURRENCY_MISMATCH quando a moeda diverge', async () => {
    const { useCase, walletRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'USD',
        balance: Money.from({ amount: '100.00', currency: 'USD' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(baseInput());

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.CURRENCY_MISMATCH);
  });

  it('lança InternalKindNotAllowedError para kind OPENING, sem persistir nada', async () => {
    const { useCase, wagerTransactionRepository, outboxRepository } = buildUseCase();

    await expect(
      useCase.execute(baseInput({ kind: WagerTransactionKind.OPENING })),
    ).rejects.toThrow(InternalKindNotAllowedError);

    expect(wagerTransactionRepository.store.size).toBe(0);
    expect(outboxRepository.store).toHaveLength(0);
  });

});

function seedProcessedReference(
  wagerTransactionRepository: InMemoryWagerTransactionRepository,
  overrides: Partial<{
    id: string;
    externalTransactionId: string;
    kind: WagerTransactionKind;
    providerId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    money: { amount: string; currency: string };
  }> = {},
): WagerTransaction {
  const reference = WagerTransaction.rehydrate({
    id: overrides.id ?? 'ref-tx-1',
    providerId: overrides.providerId ?? 'provider-a',
    externalTransactionId: overrides.externalTransactionId ?? 'ext-bet-1',
    idempotencyKey: 'idem-ref-1',
    payloadHash: 'hash',
    walletId: overrides.walletId ?? 'wallet-1',
    playerId: overrides.playerId ?? 'player-1',
    roundId: overrides.roundId ?? 'round-1',
    kind: overrides.kind ?? WagerTransactionKind.BET,
    money: Money.from(overrides.money ?? { amount: '25.00', currency: 'BRL' }),
    status: WagerTransactionStatus.PROCESSED,
    processedAt: new Date('2026-08-13T00:00:00.000Z'),
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
  });
  wagerTransactionRepository.store.set(reference.id, reference);
  return reference;
}

describe('ProcessWagerTransactionUseCase — REFUND', () => {
  it('credita de volta e resolve a referência quando o BET referenciado está PROCESSED', async () => {
    const { useCase, walletRepository, wagerTransactionRepository, ledgerRepository, outboxRepository } =
      buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '75.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository);

    const result = await useCase.execute(
      baseInput({
        kind: WagerTransactionKind.REFUND,
        referenceExternalTransactionId: 'ext-bet-1',
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('100.00');
    expect(ledgerRepository.store[0]?.direction).toBe(LedgerDirection.CREDIT);

    const persisted = [...wagerTransactionRepository.store.values()].find(
      (t) => t.id === result.transactionId,
    );
    expect(persisted?.referenceTransactionId()).toBe('ref-tx-1');
    expect(outboxRepository.store).toHaveLength(2);
  });

  it('retorna PENDING_REFERENCE quando a referência ainda não chegou', async () => {
    const { useCase, walletRepository, wagerTransactionRepository, outboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(
      baseInput({
        kind: WagerTransactionKind.REFUND,
        referenceExternalTransactionId: 'ext-bet-inexistente',
      }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
    const persisted = [...wagerTransactionRepository.store.values()].find(
      (t) => t.id === result.transactionId,
    );
    expect(persisted?.status()).toBe(WagerTransactionStatus.PENDING_REFERENCE);
    expect(outboxRepository.store).toHaveLength(1);
    expect(outboxRepository.store[0]?.eventType).toBe('WagerTransactionPendingReference');
  });

  it('rejeita REFERENCE_NOT_PROCESSED quando a referência não está PROCESSED', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    const reference = WagerTransaction.rehydrate({
      id: 'ref-tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: 'idem-ref-1',
      payloadHash: 'hash',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      status: WagerTransactionStatus.PENDING,
      createdAt: new Date(),
    });
    wagerTransactionRepository.store.set(reference.id, reference);

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.REFUND, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REFERENCE_NOT_PROCESSED);
  });

  it('rejeita REFERENCE_KIND_NOT_REVERSIBLE quando a referência não é um BET', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { kind: WagerTransactionKind.WIN });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.REFUND, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REFERENCE_KIND_NOT_REVERSIBLE);
  });

  it('rejeita REFERENCE_AMOUNT_MISMATCH quando o valor diverge do BET', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { money: { amount: '30.00', currency: 'BRL' } });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.REFUND, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REFERENCE_AMOUNT_MISMATCH);
  });

  it('rejeita REFERENCE_CONTEXT_MISMATCH quando a rodada diverge', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { roundId: 'round-outro' });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.REFUND, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REFERENCE_CONTEXT_MISMATCH);
  });

  it('rejeita REFERENCE_ALREADY_REVERSED numa segunda tentativa de REFUND para a mesma referência', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    const reference = seedProcessedReference(wagerTransactionRepository);
    const firstRefund = WagerTransaction.rehydrate({
      id: 'refund-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: 'idem-refund-1',
      payloadHash: 'hash',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      kind: WagerTransactionKind.REFUND,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
      referenceTransactionId: reference.id,
      status: WagerTransactionStatus.PROCESSED,
      processedAt: new Date(),
      createdAt: new Date(),
    });
    wagerTransactionRepository.store.set(firstRefund.id, firstRefund);

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.REFUND, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REFERENCE_ALREADY_REVERSED);
  });
});

describe('ProcessWagerTransactionUseCase — ROLLBACK', () => {
  it('inverte a direção de um BET (DEBIT vira CREDIT)', async () => {
    const { useCase, walletRepository, wagerTransactionRepository, ledgerRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '75.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { kind: WagerTransactionKind.BET });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.ROLLBACK, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('100.00');
    expect(ledgerRepository.store[0]?.direction).toBe(LedgerDirection.CREDIT);
  });

  it('inverte a direção de um WIN (CREDIT vira DEBIT)', async () => {
    const { useCase, walletRepository, wagerTransactionRepository, ledgerRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { kind: WagerTransactionKind.WIN });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.ROLLBACK, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance?.amount).toBe('75.00');
    expect(ledgerRepository.store[0]?.direction).toBe(LedgerDirection.DEBIT);
  });

  it('rejeita REVERSAL_WOULD_OVERDRAW quando reverter um WIN já consumido deixaria saldo negativo', async () => {
    const { useCase, walletRepository, wagerTransactionRepository, ledgerRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '5.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { kind: WagerTransactionKind.WIN });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.ROLLBACK, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REVERSAL_WOULD_OVERDRAW);
    expect(ledgerRepository.store).toHaveLength(0);

    const wallet = walletRepository.store.get('wallet-1');
    expect(wallet?.balance().toJSON().amount).toBe('5.00');
  });

  it('rejeita REFERENCE_KIND_NOT_REVERSIBLE ao tentar reverter uma LOSS', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    seedProcessedReference(wagerTransactionRepository, { kind: WagerTransactionKind.LOSS });

    const result = await useCase.execute(
      baseInput({ kind: WagerTransactionKind.ROLLBACK, referenceExternalTransactionId: 'ext-bet-1' }),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.REFERENCE_KIND_NOT_REVERSIBLE);
  });
});

describe('ProcessWagerTransactionUseCase — replay e conflito de idempotência', () => {
  it('reenvio com o mesmo payload é replay idempotente e devolve o saldo histórico, não o atual', async () => {
    const { useCase, walletRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const original = baseInput({ idempotencyKey: 'idem-fixo', externalTransactionId: 'ext-fixo' });
    const first = await useCase.execute(original);
    expect(first.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(first.balance?.amount).toBe('75.00');
    expect(first.idempotentReplay).toBe(false);

    await useCase.execute(
      baseInput({ idempotencyKey: 'idem-outra', externalTransactionId: 'ext-outra', money: { amount: '10.00', currency: 'BRL' } }),
    );

    const replay = await useCase.execute(original);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.balance?.amount).toBe('75.00');
  });

  it('reenvio com a mesma chave mas payload diferente lança IdempotencyPayloadConflictError', async () => {
    const { useCase, walletRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    await useCase.execute(baseInput({ idempotencyKey: 'idem-fixo', externalTransactionId: 'ext-fixo' }));

    await expect(
      useCase.execute(
        baseInput({
          idempotencyKey: 'idem-fixo',
          externalTransactionId: 'ext-fixo',
          money: { amount: '99.00', currency: 'BRL' },
        }),
      ),
    ).rejects.toThrow(IdempotencyPayloadConflictError);
  });

  it('lança ConcurrentIdempotencyProcessingError quando a transação existente ainda está PENDING', async () => {
    const { useCase, walletRepository, wagerTransactionRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const input = baseInput({ idempotencyKey: 'idem-concorrente', externalTransactionId: 'ext-concorrente' });
    const money = Money.from(input.money);
    const payloadHash = await computePayloadHash({
      providerId: input.declaredProviderId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: money.toJSON(),
    });
    const pending = WagerTransaction.create({
      id: 'tx-em-andamento',
      providerId: input.declaredProviderId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      kind: input.kind,
      money,
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
    });
    wagerTransactionRepository.store.set(pending.id, pending);

    await expect(useCase.execute(input)).rejects.toThrow(ConcurrentIdempotencyProcessingError);
  });
});

describe('ProcessWagerTransactionUseCase — deduplicação por inbox (T-049)', () => {
  it('sem deduplication informado, não consulta a inbox', async () => {
    const { useCase, walletRepository, inboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    await useCase.execute(baseInput());

    expect(inboxRepository.calls).toHaveLength(0);
  });

  it('na primeira entrega, registra na inbox e processa normalmente', async () => {
    const { useCase, walletRepository, inboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );

    const result = await useCase.execute(baseInput(), {
      messageId: 'sqs-msg-1',
      consumerName: 'wagering-consumer',
    });

    expect('duplicateMessage' in result).toBe(false);
    if (!('duplicateMessage' in result)) {
      expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    }
    expect(inboxRepository.calls).toHaveLength(1);
    expect(inboxRepository.calls[0]).toEqual({
      messageId: 'sqs-msg-1',
      consumerName: 'wagering-consumer',
      payloadHash: await computePayloadHash({
        providerId: 'provider-a',
        externalTransactionId: 'ext-1',
        playerId: 'player-1',
        walletId: 'wallet-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });
  });

  it('numa redelivery da mesma mensagem, pula o processamento e não repete efeitos colaterais', async () => {
    const { useCase, walletRepository, ledgerRepository, outboxRepository, inboxRepository } = buildUseCase();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    const dedup = { messageId: 'sqs-msg-1', consumerName: 'wagering-consumer' };

    await useCase.execute(baseInput(), dedup);
    const wallet = walletRepository.store.get('wallet-1');
    expect(wallet?.balance().toJSON().amount).toBe('75.00');

    const secondResult = await useCase.execute(baseInput(), dedup);

    expect(secondResult).toEqual({ duplicateMessage: true });
    expect(inboxRepository.calls).toHaveLength(2);
    expect(walletRepository.store.get('wallet-1')?.balance().toJSON().amount).toBe('75.00');
    expect(ledgerRepository.store).toHaveLength(1);
    expect(outboxRepository.store).toHaveLength(2);
  });

  it('em uma rejeição de negócio, também registra na inbox no mesmo commit', async () => {
    const { useCase, inboxRepository, outboxRepository } = buildUseCase();
    const dedup = { messageId: 'sqs-msg-rejeitado', consumerName: 'wagering-consumer' };

    const result = await useCase.execute(baseInput(), dedup);

    if (!('duplicateMessage' in result)) {
      expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    }
    expect(inboxRepository.calls).toHaveLength(1);
    expect(outboxRepository.store).toHaveLength(1);

    const secondResult = await useCase.execute(baseInput(), dedup);
    expect(secondResult).toEqual({ duplicateMessage: true });
  });
});
