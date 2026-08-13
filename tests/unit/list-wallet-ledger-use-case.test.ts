import { describe, expect, it } from 'bun:test';
import type { LedgerCursor } from '@application/dto/ledger-cursor.ts';
import { encodeLedgerCursor } from '@application/dto/ledger-cursor.ts';
import type { LedgerPage } from '@application/dto/ledger-page.ts';
import type { WalletView } from '@application/dto/wallet-view.ts';
import { InvalidCursorError } from '@application/errors/invalid-cursor-error.ts';
import { InvalidPaginationLimitError } from '@application/errors/invalid-pagination-limit-error.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import { Money } from '@domain/money/money.ts';
import type { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import { ListWalletLedgerUseCase } from '@application/use-cases/list-wallet-ledger-use-case.ts';

class NoopUnitOfWork implements UnitOfWork {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}

class FixedWalletRepository implements WalletRepository {
  constructor(private readonly exists: boolean) {}

  async findById(): Promise<Wallet | undefined> {
    return this.exists
      ? Wallet.open({ id: 'wallet-1', playerId: 'player-1', currency: 'BRL' })
      : undefined;
  }

  async findViewById(): Promise<WalletView | undefined> {
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

class RecordingLedgerRepository implements LedgerRepository {
  receivedCursor: LedgerCursor | undefined;
  receivedLimit: number | undefined;

  constructor(private readonly page: LedgerPage) {}

  async findPageByWalletId(
    _ctx: TransactionContext,
    _walletId: string,
    cursor: LedgerCursor | undefined,
    limit: number,
  ): Promise<LedgerPage> {
    this.receivedCursor = cursor;
    this.receivedLimit = limit;
    return this.page;
  }

  async insert(): Promise<void> {}

  async findByTransactionId(): Promise<WalletLedgerEntry | undefined> {
    return undefined;
  }

  async sumByWalletId(): Promise<Money> {
    return Money.zero('BRL');
  }

  async countByWalletId(): Promise<number> {
    return 0;
  }
}

function buildUseCase(walletExists: boolean, page: LedgerPage) {
  const ledgerRepository = new RecordingLedgerRepository(page);
  const useCase = new ListWalletLedgerUseCase(
    new NoopUnitOfWork(),
    new FixedWalletRepository(walletExists),
    ledgerRepository,
  );
  return { useCase, ledgerRepository };
}

describe('ListWalletLedgerUseCase', () => {
  it('usa o limite default de 50 quando não informado', async () => {
    const { useCase, ledgerRepository } = buildUseCase(true, {
      entries: [],
      hasMore: false,
      nextCursor: undefined,
    });

    await useCase.execute({ walletId: 'wallet-1' });

    expect(ledgerRepository.receivedLimit).toBe(50);
    expect(ledgerRepository.receivedCursor).toBeUndefined();
  });

  it('decodifica o cursor informado e repassa ao repositório', async () => {
    const { useCase, ledgerRepository } = buildUseCase(true, {
      entries: [],
      hasMore: false,
      nextCursor: undefined,
    });
    const cursor: LedgerCursor = { createdAt: '2026-08-12T00:00:00.000Z', id: 'entry-1' };

    await useCase.execute({ walletId: 'wallet-1', cursor: encodeLedgerCursor(cursor) });

    expect(ledgerRepository.receivedCursor).toEqual(cursor);
  });

  it('lança InvalidCursorError para um cursor malformado', async () => {
    const { useCase } = buildUseCase(true, { entries: [], hasMore: false, nextCursor: undefined });

    await expect(
      useCase.execute({ walletId: 'wallet-1', cursor: 'não-é-base64-json-válido' }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it('lança InvalidPaginationLimitError para limite fora de [1, 100]', async () => {
    const { useCase } = buildUseCase(true, { entries: [], hasMore: false, nextCursor: undefined });

    await expect(useCase.execute({ walletId: 'wallet-1', limit: 0 })).rejects.toThrow(
      InvalidPaginationLimitError,
    );
    await expect(useCase.execute({ walletId: 'wallet-1', limit: 101 })).rejects.toThrow(
      InvalidPaginationLimitError,
    );
  });

  it('lança WalletNotFoundError quando a wallet não existe', async () => {
    const { useCase } = buildUseCase(false, { entries: [], hasMore: false, nextCursor: undefined });

    await expect(useCase.execute({ walletId: 'inexistente' })).rejects.toThrow(WalletNotFoundError);
  });

  it('devolve a página tal como o repositório retorna', async () => {
    const page: LedgerPage = { entries: [], hasMore: true, nextCursor: 'abc123' };
    const { useCase } = buildUseCase(true, page);

    const result = await useCase.execute({ walletId: 'wallet-1' });

    expect(result).toEqual(page);
  });
});
