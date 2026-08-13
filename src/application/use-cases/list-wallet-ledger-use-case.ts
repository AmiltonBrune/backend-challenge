import type { LedgerPage } from '@application/dto/ledger-page.ts';
import { decodeLedgerCursor } from '@application/dto/ledger-cursor.ts';
import { InvalidPaginationLimitError } from '@application/errors/invalid-pagination-limit-error.ts';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface ListWalletLedgerInput {
  readonly walletId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export type ListWalletLedgerResult = LedgerPage;

export class ListWalletLedgerUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly walletRepository: WalletRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async execute(input: ListWalletLedgerInput): Promise<ListWalletLedgerResult> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new InvalidPaginationLimitError(limit);
    }
    const cursor = input.cursor !== undefined ? decodeLedgerCursor(input.cursor) : undefined;

    return this.unitOfWork.run(async (ctx) => {
      const wallet = await this.walletRepository.findById(ctx, input.walletId);
      if (wallet === undefined) {
        throw new WalletNotFoundError(input.walletId);
      }

      return this.ledgerRepository.findPageByWalletId(ctx, input.walletId, cursor, limit);
    });
  }
}
