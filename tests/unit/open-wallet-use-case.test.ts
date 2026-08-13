import { describe, expect, it } from 'bun:test';
import type { Clock } from '@application/ports/clock.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletAlreadyExistsError } from '@application/errors/wallet-already-exists-error.ts';
import { OpenWalletUseCase } from '@application/use-cases/open-wallet-use-case.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import type { Wallet } from '@domain/wallet/wallet.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';

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

class InMemoryWalletRepository implements WalletRepository {
  readonly store = new Map<string, Wallet>();
  private readonly conflictFor: { playerId: string; currency: string } | undefined;

  constructor(conflictFor?: { playerId: string; currency: string }) {
    this.conflictFor = conflictFor;
  }

  async findById(_ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    return this.store.get(id);
  }

  async findByIdForUpdate(_ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    return this.store.get(id);
  }

  async findViewById() {
    return undefined;
  }

  async findByPlayerAndCurrency(
    _ctx: TransactionContext,
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined> {
    return [...this.store.values()].find(
      (w) => w.playerId === playerId && w.currency === currency,
    );
  }

  async insert(_ctx: TransactionContext, wallet: Wallet): Promise<void> {
    if (
      this.conflictFor !== undefined &&
      this.conflictFor.playerId === wallet.playerId &&
      this.conflictFor.currency === wallet.currency
    ) {
      throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
    }
    this.store.set(wallet.id, wallet);
  }

  async update(_ctx: TransactionContext, wallet: Wallet): Promise<void> {
    this.store.set(wallet.id, wallet);
  }
}

class InMemoryWagerTransactionRepository implements WagerTransactionRepository {
  readonly store = new Map<string, WagerTransaction>();

  async insert(_ctx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    this.store.set(transaction.id, transaction);
  }

  async update(_ctx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    this.store.set(transaction.id, transaction);
  }

  async findById(_ctx: TransactionContext, id: string): Promise<WagerTransaction | undefined> {
    return this.store.get(id);
  }

  async findByProviderAndIdempotencyKey(): Promise<WagerTransaction | undefined> {
    return undefined;
  }

  async findByProviderAndExternalTransactionId(): Promise<WagerTransaction | undefined> {
    return undefined;
  }

  async findProcessedReversalByReference(): Promise<WagerTransaction | undefined> {
    return undefined;
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

function buildUseCase(conflictFor?: { playerId: string; currency: string }) {
  const walletRepository = new InMemoryWalletRepository(conflictFor);
  const wagerTransactionRepository = new InMemoryWagerTransactionRepository();
  const ledgerRepository = new InMemoryLedgerRepository();
  const outboxRepository = new InMemoryOutboxRepository();
  const clock = new FixedClock(new Date('2026-08-13T00:00:00.000Z'));
  const idGenerator = new SequentialIdGenerator();

  const useCase = new OpenWalletUseCase(
    new NoopUnitOfWork(),
    walletRepository,
    wagerTransactionRepository,
    ledgerRepository,
    outboxRepository,
    clock,
    idGenerator,
  );

  return { useCase, walletRepository, wagerTransactionRepository, ledgerRepository, outboxRepository };
}

describe('OpenWalletUseCase — saldo inicial positivo', () => {
  it('cria a wallet com version 1 e balance igual ao saldo inicial', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    expect(result.wallet.balance().toJSON().amount).toBe('1000.00');
    expect(result.wallet.version()).toBe(1);
    expect(result.wallet.playerId).toBe('player-1');
    expect(result.wallet.currency).toBe('BRL');
  });

  it('cria uma transação interna OPENING já PROCESSED', async () => {
    const { useCase, wagerTransactionRepository } = buildUseCase();

    await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    const transactions = [...wagerTransactionRepository.store.values()];
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.kind).toBe(WagerTransactionKind.OPENING);
    expect(transactions[0]?.status()).toBe(WagerTransactionStatus.PROCESSED);
  });

  it('cria um lançamento CREDIT de 0 até o saldo inicial', async () => {
    const { useCase, ledgerRepository } = buildUseCase();

    await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    expect(ledgerRepository.store).toHaveLength(1);
    const entry = ledgerRepository.store[0];
    expect(entry?.direction).toBe(LedgerDirection.CREDIT);
    expect(entry?.balanceBefore.toJSON().amount).toBe('0.00');
    expect(entry?.balanceAfter.toJSON().amount).toBe('1000.00');
  });

  it('emite WalletOpened seguido de WalletBalanceChanged', async () => {
    const { useCase, outboxRepository } = buildUseCase();

    await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    expect(outboxRepository.store).toHaveLength(2);
    expect(outboxRepository.store[0]?.eventType).toBe('WalletOpened');
    expect(outboxRepository.store[1]?.eventType).toBe('WalletBalanceChanged');
  });

  it('os dois eventos compartilham o mesmo correlationId', async () => {
    const { useCase, outboxRepository } = buildUseCase();

    await useCase.execute({
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    const [opened, balanceChanged] = outboxRepository.store;
    expect(opened?.payload.correlationId).toBeDefined();
    expect(opened?.payload.correlationId).toBe(balanceChanged?.payload.correlationId);
  });
});

describe('OpenWalletUseCase — saldo inicial zero', () => {
  it('cria a wallet com balance zero e version 1, sem transação interna nem lançamento', async () => {
    const { useCase, wagerTransactionRepository, ledgerRepository } = buildUseCase();

    const result = await useCase.execute({
      playerId: 'player-2',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    expect(result.wallet.balance().toJSON().amount).toBe('0.00');
    expect(result.wallet.version()).toBe(1);
    expect(wagerTransactionRepository.store.size).toBe(0);
    expect(ledgerRepository.store).toHaveLength(0);
  });

  it('emite somente WalletOpened', async () => {
    const { useCase, outboxRepository } = buildUseCase();

    await useCase.execute({
      playerId: 'player-2',
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    expect(outboxRepository.store).toHaveLength(1);
    expect(outboxRepository.store[0]?.eventType).toBe('WalletOpened');
  });
});

describe('OpenWalletUseCase — conflito e validação', () => {
  it('propaga WalletAlreadyExistsError para o mesmo playerId e currency, sem efeitos colaterais', async () => {
    const { useCase, wagerTransactionRepository, ledgerRepository, outboxRepository } = buildUseCase({
      playerId: 'player-3',
      currency: 'BRL',
    });

    await expect(
      useCase.execute({
        playerId: 'player-3',
        initialBalance: { amount: '500.00', currency: 'BRL' },
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);

    expect(wagerTransactionRepository.store.size).toBe(0);
    expect(ledgerRepository.store).toHaveLength(0);
    expect(outboxRepository.store).toHaveLength(0);
  });

  it('propaga o erro de Money para saldo inicial negativo, sem criar nada', async () => {
    const { useCase, walletRepository } = buildUseCase();

    await expect(
      useCase.execute({
        playerId: 'player-4',
        initialBalance: { amount: '-10.00', currency: 'BRL' },
      }),
    ).rejects.toThrow();

    expect(walletRepository.store.size).toBe(0);
  });
});
