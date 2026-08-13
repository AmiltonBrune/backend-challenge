import { describe, expect, it } from 'bun:test';
import type { Clock } from '@application/ports/clock.ts';
import type { IdGenerator } from '@application/ports/id-generator.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { OutboxRepository } from '@application/ports/outbox-repository.ts';
import type { ProviderIdentityPort } from '@application/ports/provider-identity-port.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';
import { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import type { OutboxMessage } from '@domain/messaging/outbox-message.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import type { WagerTransaction } from '@domain/wager-transaction/wager-transaction.ts';
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

  async findByIdForUpdate(_ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    return this.store.get(id);
  }

  async findByPlayerAndCurrency(): Promise<Wallet | undefined> {
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
}

class InMemoryLedgerRepository implements LedgerRepository {
  readonly store: WalletLedgerEntry[] = [];

  async insert(_ctx: TransactionContext, entry: WalletLedgerEntry): Promise<void> {
    this.store.push(entry);
  }

  async findByTransactionId(): Promise<WalletLedgerEntry | undefined> {
    return undefined;
  }

  async sumByWalletId(): Promise<never> {
    throw new Error('não usado neste teste');
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

function buildUseCase() {
  const walletRepository = new InMemoryWalletRepository();
  const wagerTransactionRepository = new InMemoryWagerTransactionRepository();
  const ledgerRepository = new InMemoryLedgerRepository();
  const outboxRepository = new InMemoryOutboxRepository();
  const clock = new FixedClock(new Date('2026-08-13T00:00:00.000Z'));
  const idGenerator = new SequentialIdGenerator();

  const useCase = new ProcessWagerTransactionUseCase(
    new NoopUnitOfWork(),
    walletRepository,
    wagerTransactionRepository,
    ledgerRepository,
    outboxRepository,
    new DeclaredIdentity(),
    clock,
    idGenerator,
  );

  return { useCase, walletRepository, wagerTransactionRepository, ledgerRepository, outboxRepository };
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

  it('lança para REFUND, ainda não suportado por este caso de uso', async () => {
    const { useCase, wagerTransactionRepository } = buildUseCase();

    await expect(
      useCase.execute(
        baseInput({
          kind: WagerTransactionKind.REFUND,
          referenceExternalTransactionId: 'ext-bet-1',
        }),
      ),
    ).rejects.toThrow();

    expect(wagerTransactionRepository.store.size).toBe(0);
  });
});
