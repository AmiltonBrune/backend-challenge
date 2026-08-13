import { describe, expect, it } from 'bun:test';
import type { IsolationLevel, UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import { Money } from '@domain/money/money.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { ReconcileWalletUseCase } from '@application/use-cases/reconcile-wallet-use-case.ts';

class RecordingUnitOfWork implements UnitOfWork {
  usedIsolationLevel: IsolationLevel | undefined;

  async run<T>(
    work: (ctx: TransactionContext) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    this.usedIsolationLevel = isolationLevel;
    return work(undefined);
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

  async insert(_ctx: TransactionContext, wallet: Wallet): Promise<void> {
    this.store.set(wallet.id, wallet);
  }

  async update(_ctx: TransactionContext, wallet: Wallet): Promise<void> {
    this.store.set(wallet.id, wallet);
  }
}

class FixedLedgerRepository implements LedgerRepository {
  constructor(
    private readonly sum: Money,
    private readonly count: number,
  ) {}

  async insert(): Promise<void> {}

  async findByTransactionId(): Promise<undefined> {
    return undefined;
  }

  async sumByWalletId(): Promise<Money> {
    return this.sum;
  }

  async countByWalletId(): Promise<number> {
    return this.count;
  }
}

function buildUseCase(walletRepository: InMemoryWalletRepository, ledgerRepository: LedgerRepository) {
  const unitOfWork = new RecordingUnitOfWork();
  const useCase = new ReconcileWalletUseCase(unitOfWork, walletRepository, ledgerRepository);
  return { useCase, unitOfWork };
}

describe('ReconcileWalletUseCase', () => {
  it('roda em isolamento REPEATABLE READ', async () => {
    const walletRepository = new InMemoryWalletRepository();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    const { useCase, unitOfWork } = buildUseCase(
      walletRepository,
      new FixedLedgerRepository(Money.from({ amount: '100.00', currency: 'BRL' }), 1),
    );

    await useCase.execute({ walletId: 'wallet-1' });

    expect(unitOfWork.usedIsolationLevel).toBe('REPEATABLE READ');
  });

  it('reporta consistent:true quando o saldo armazenado bate com o agregado do ledger', async () => {
    const walletRepository = new InMemoryWalletRepository();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    const { useCase } = buildUseCase(
      walletRepository,
      new FixedLedgerRepository(Money.from({ amount: '100.00', currency: 'BRL' }), 3),
    );

    const result = await useCase.execute({ walletId: 'wallet-1' });

    expect(result.consistent).toBe(true);
    expect(result.storedBalance.amount).toBe('100.00');
    expect(result.calculatedBalance.amount).toBe('100.00');
    expect(result.difference.amount).toBe('0.00');
    expect(result.checkedEntries).toBe(3);
  });

  it('reporta consistent:false e a diferença com sinal quando os valores divergem', async () => {
    const walletRepository = new InMemoryWalletRepository();
    walletRepository.seed(
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: Money.from({ amount: '100.00', currency: 'BRL' }),
        version: 1,
      }),
    );
    const { useCase } = buildUseCase(
      walletRepository,
      new FixedLedgerRepository(Money.from({ amount: '80.00', currency: 'BRL' }), 2),
    );

    const result = await useCase.execute({ walletId: 'wallet-1' });

    expect(result.consistent).toBe(false);
    expect(result.difference.amount).toBe('20.00');
  });

  it('lança WalletNotFoundError quando a wallet não existe', async () => {
    const walletRepository = new InMemoryWalletRepository();
    const { useCase } = buildUseCase(
      walletRepository,
      new FixedLedgerRepository(Money.zero('BRL'), 0),
    );

    await expect(useCase.execute({ walletId: 'inexistente' })).rejects.toThrow(WalletNotFoundError);
  });
});
