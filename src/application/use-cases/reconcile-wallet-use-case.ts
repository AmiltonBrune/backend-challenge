import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import type { MoneyProps } from '@domain/money/money-props.ts';

export interface ReconcileWalletInput {
  readonly walletId: string;
}

export interface ReconcileWalletResult {
  readonly walletId: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly walletRepository: WalletRepository,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async execute(input: ReconcileWalletInput): Promise<ReconcileWalletResult> {
    return this.unitOfWork.run(async (ctx) => {
      const wallet = await this.walletRepository.findById(ctx, input.walletId);
      if (wallet === undefined) {
        throw new WalletNotFoundError(input.walletId);
      }

      const storedBalance = wallet.balance();
      const calculatedBalance = await this.ledgerRepository.sumByWalletId(
        ctx,
        input.walletId,
        wallet.currency,
      );
      const checkedEntries = await this.ledgerRepository.countByWalletId(ctx, input.walletId);

      const difference = storedBalance.subtract(calculatedBalance);

      return {
        walletId: input.walletId,
        storedBalance: storedBalance.toJSON(),
        calculatedBalance: calculatedBalance.toJSON(),
        difference: difference.toJSON(),
        consistent: difference.isZero(),
        checkedEntries,
      };
    }, 'REPEATABLE READ');
  }
}
