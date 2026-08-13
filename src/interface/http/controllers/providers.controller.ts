import { Controller, Get, Param } from '@nestjs/common';
import { GetWagerTransactionUseCase } from '@application/use-cases/get-wager-transaction-use-case.ts';
import { ProviderExternalTransactionParamDto } from '@interface/http/dto/index.ts';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly getWagerTransaction: GetWagerTransactionUseCase) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  async findOne(@Param() params: ProviderExternalTransactionParamDto) {
    return this.getWagerTransaction.execute({
      providerId: params.providerId,
      externalTransactionId: params.externalTransactionId,
    });
  }
}
