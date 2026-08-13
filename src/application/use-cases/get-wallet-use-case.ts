import type { WalletView } from '@application/dto/wallet-view.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';

export interface GetWalletInput {
  readonly walletId: string;
}

export type GetWalletResult = WalletView;

export class GetWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly walletRepository: WalletRepository,
  ) {}

  async execute(input: GetWalletInput): Promise<GetWalletResult> {
    return this.unitOfWork.run(async (ctx) => {
      const view = await this.walletRepository.findViewById(ctx, input.walletId);
      if (view === undefined) {
        throw new WalletNotFoundError(input.walletId);
      }
      return view;
    });
  }
}
