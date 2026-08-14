import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetWalletUseCase } from '@application/use-cases/get-wallet-use-case.ts';
import { ListWalletLedgerUseCase } from '@application/use-cases/list-wallet-ledger-use-case.ts';
import { OpenWalletUseCase } from '@application/use-cases/open-wallet-use-case.ts';
import { ReconcileWalletUseCase } from '@application/use-cases/reconcile-wallet-use-case.ts';
import {
  ListWalletLedgerQueryDto,
  OpenWalletRequestDto,
  WalletIdParamDto,
} from '@interface/http/dto/index.ts';

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly openWallet: OpenWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly listWalletLedger: ListWalletLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Abre uma carteira com saldo inicial.' })
  @ApiResponse({ status: 201, description: 'Carteira criada.' })
  @ApiResponse({ status: 400, description: 'Corpo da requisição inválido.' })
  async create(@Body() body: OpenWalletRequestDto) {
    const result = await this.openWallet.execute({
      playerId: body.playerId,
      initialBalance: body.initialBalance,
    });

    return {
      id: result.wallet.id,
      playerId: result.wallet.playerId,
      balance: result.wallet.balance().toJSON(),
      version: result.wallet.version(),
    };
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Consulta uma carteira pelo id.' })
  @ApiParam({ name: 'walletId', example: '01145c5f-dc27-4bb8-a750-db94ff3c0303' })
  @ApiResponse({ status: 200, description: 'Carteira encontrada.' })
  @ApiResponse({ status: 404, description: 'Carteira não encontrada.' })
  async findOne(@Param() params: WalletIdParamDto) {
    return this.getWallet.execute({ walletId: params.walletId });
  }

  @Get(':walletId/ledger')
  @ApiOperation({ summary: 'Lista o ledger (histórico de lançamentos) da carteira, paginado por cursor.' })
  @ApiParam({ name: 'walletId', example: '01145c5f-dc27-4bb8-a750-db94ff3c0303' })
  async listLedger(
    @Param() params: WalletIdParamDto,
    @Query() query: ListWalletLedgerQueryDto,
  ) {
    const page = await this.listWalletLedger.execute({
      walletId: params.walletId,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });

    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confere se o saldo da carteira bate com a soma dos lançamentos do ledger.' })
  @ApiParam({ name: 'walletId', example: '01145c5f-dc27-4bb8-a750-db94ff3c0303' })
  async reconcile(@Param() params: WalletIdParamDto) {
    return this.reconcileWallet.execute({ walletId: params.walletId });
  }
}
