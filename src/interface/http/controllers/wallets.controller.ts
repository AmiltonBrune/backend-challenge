import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { GetWalletUseCase } from '@application/use-cases/get-wallet-use-case.ts';
import { ListWalletLedgerUseCase } from '@application/use-cases/list-wallet-ledger-use-case.ts';
import { OpenWalletUseCase } from '@application/use-cases/open-wallet-use-case.ts';
import { ReconcileWalletUseCase } from '@application/use-cases/reconcile-wallet-use-case.ts';
import {
  ListWalletLedgerQueryDto,
  OpenWalletRequestDto,
  WalletIdParamDto,
} from '@interface/http/dto/index.ts';

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
  async findOne(@Param() params: WalletIdParamDto) {
    return this.getWallet.execute({ walletId: params.walletId });
  }

  @Get(':walletId/ledger')
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
  async reconcile(@Param() params: WalletIdParamDto) {
    return this.reconcileWallet.execute({ walletId: params.walletId });
  }
}
