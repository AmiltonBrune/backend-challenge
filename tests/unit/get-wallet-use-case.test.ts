import { describe, expect, it } from 'bun:test';
import type { WalletView } from '@application/dto/wallet-view.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import type { Wallet } from '@domain/wallet/wallet.ts';
import { GetWalletUseCase } from '@application/use-cases/get-wallet-use-case.ts';

class NoopUnitOfWork implements UnitOfWork {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

class FixedWalletRepository implements WalletRepository {
  constructor(private readonly view: WalletView | undefined) {}

  async findViewById(): Promise<WalletView | undefined> {
    return this.view;
  }

  async findById(): Promise<Wallet | undefined> {
    return undefined;
  }

  async findByIdForUpdate(): Promise<Wallet | undefined> {
    return undefined;
  }

  async findByPlayerAndCurrency(): Promise<Wallet | undefined> {
    return undefined;
  }

  async insert(): Promise<void> {}

  async update(): Promise<void> {}
}

describe('GetWalletUseCase', () => {
  it('retorna a view quando a wallet existe', async () => {
    const view: WalletView = {
      id: 'wallet-1',
      playerId: 'player-1',
      balance: { amount: '100.00', currency: 'BRL' },
      version: 3,
      updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    };
    const useCase = new GetWalletUseCase(new NoopUnitOfWork(), new FixedWalletRepository(view));

    const result = await useCase.execute({ walletId: 'wallet-1' });

    expect(result).toEqual(view);
  });

  it('lança WalletNotFoundError quando a wallet não existe', async () => {
    const useCase = new GetWalletUseCase(new NoopUnitOfWork(), new FixedWalletRepository(undefined));

    await expect(useCase.execute({ walletId: 'inexistente' })).rejects.toThrow(
      WalletNotFoundError,
    );
  });
});
