import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetWagerTransactionUseCase } from '@application/use-cases/get-wager-transaction-use-case.ts';
import { ProviderExternalTransactionParamDto } from '@interface/http/dto/index.ts';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly getWagerTransaction: GetWagerTransactionUseCase) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  @ApiOperation({ summary: 'Consulta uma transação pelo par (providerId, externalTransactionId) declarado pelo provedor.' })
  @ApiParam({ name: 'providerId', example: 'provider-a' })
  @ApiParam({ name: 'externalTransactionId', example: 'bet-001' })
  @ApiResponse({ status: 200, description: 'Transação encontrada.' })
  @ApiResponse({ status: 404, description: 'Transação não encontrada.' })
  async findOne(@Param() params: ProviderExternalTransactionParamDto) {
    return this.getWagerTransaction.execute({
      providerId: params.providerId,
      externalTransactionId: params.externalTransactionId,
    });
  }
}
