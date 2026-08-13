import type { WagerTransactionView } from '@application/dto/wager-transaction-view.ts';
import { WagerTransactionNotFoundError } from '@application/errors/wager-transaction-not-found-error.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import type { WagerTransactionRepository } from '@application/ports/wager-transaction-repository.ts';

export type GetWagerTransactionInput =
  | { readonly transactionId: string }
  | { readonly providerId: string; readonly externalTransactionId: string };

export type GetWagerTransactionResult = WagerTransactionView;

export class GetWagerTransactionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly wagerTransactionRepository: WagerTransactionRepository,
  ) {}

  async execute(input: GetWagerTransactionInput): Promise<GetWagerTransactionResult> {
    return this.unitOfWork.run(async (ctx) => {
      const view =
        'transactionId' in input
          ? await this.wagerTransactionRepository.findViewById(ctx, input.transactionId)
          : await this.wagerTransactionRepository.findViewByProviderAndExternalTransactionId(
              ctx,
              input.providerId,
              input.externalTransactionId,
            );

      if (view === undefined) {
        throw new WagerTransactionNotFoundError(
          'transactionId' in input ? input.transactionId : input.externalTransactionId,
        );
      }

      return view;
    });
  }
}
