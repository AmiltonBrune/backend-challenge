import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';
import { GetWagerTransactionUseCase } from '@application/use-cases/get-wager-transaction-use-case.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import type { ProcessWagerTransactionResult } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { IdempotencyPayloadConflictError } from '@application/errors/idempotency-payload-conflict-error.ts';
import { METRICS_PORT } from '@application/ports/metrics-port.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';
import { WagerTransactionStatus } from '@domain/wager-transaction/wager-transaction-status.ts';
import {
  IdempotencyKeyHeaderDto,
  ProcessWagerTransactionRequestDto,
  TransactionIdParamDto,
} from '@interface/http/dto/index.ts';
import { catalogFailureCode } from '@interface/http/error-catalog.ts';

async function requireIdempotencyKey(rawHeaderValue: string | undefined): Promise<string> {
  const dto = plainToInstance(IdempotencyKeyHeaderDto, { idempotencyKey: rawHeaderValue });
  const errors = await validate(dto);
  if (errors.length > 0) {
    throw new BadRequestException({
      error: 'ERR-009',
      message: 'Chave de idempotência obrigatória.',
    });
  }
  return dto.idempotencyKey;
}

function statusFor(status: WagerTransactionStatus, idempotentReplay: boolean): number {
  if (status === WagerTransactionStatus.PROCESSED) {
    return idempotentReplay ? 200 : 201;
  }
  if (status === WagerTransactionStatus.PENDING_REFERENCE) {
    return 202;
  }
  return 422;
}

@ApiTags('wagering')
@Controller()
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getWagerTransaction: GetWagerTransactionUseCase,
    @Inject(METRICS_PORT) private readonly metrics: MetricsPort,
  ) {}

  @Post('wagering/transactions')
  @ApiOperation({
    summary: 'Processa uma transação de aposta (BET, WIN, LOSS, REFUND ou ROLLBACK), com correção financeira.',
  })
  @ApiHeader({ name: 'idempotency-key', required: true, description: 'Chave de idempotência da requisição.' })
  @ApiResponse({ status: 201, description: 'Processada pela primeira vez.' })
  @ApiResponse({ status: 200, description: 'Replay idempotente — mesmo resultado da primeira chamada.' })
  @ApiResponse({ status: 202, description: 'Aceita, aguardando resolução de referência (REFUND/ROLLBACK).' })
  @ApiResponse({ status: 422, description: 'Rejeitada (ex.: saldo insuficiente) — ver failureCode no corpo.' })
  async create(
    @Body() body: ProcessWagerTransactionRequestDto,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const idempotencyKey = await requireIdempotencyKey(rawIdempotencyKey);

    let result: ProcessWagerTransactionResult;
    try {
      result = await this.processWagerTransaction.execute({
        declaredProviderId: body.providerId,
        idempotencyKey,
        externalTransactionId: body.externalTransactionId,
        playerId: body.playerId,
        walletId: body.walletId,
        roundId: body.roundId,
        gameId: body.gameId,
        kind: body.kind,
        money: body.money,
        ...(body.referenceExternalTransactionId !== undefined
          ? { referenceExternalTransactionId: body.referenceExternalTransactionId }
          : {}),
      });
    } catch (error) {
      if (error instanceof IdempotencyPayloadConflictError) {
        this.metrics.recordIdempotencyConflict({ provider: body.providerId });
      }
      throw error;
    }

    this.metrics.recordWagerTransaction({
      kind: body.kind,
      status: result.status,
      provider: body.providerId,
    });
    if (result.idempotentReplay) {
      this.metrics.recordIdempotentReplay({ provider: body.providerId });
    }
    if (result.status === WagerTransactionStatus.REJECTED && result.failureCode !== undefined) {
      this.metrics.recordRejection({ failureCode: result.failureCode });
    }

    res.status(statusFor(result.status, result.idempotentReplay));

    if (result.status === WagerTransactionStatus.REJECTED && result.failureCode !== undefined) {
      const cataloged = catalogFailureCode(result.failureCode);
      return {
        transactionId: result.transactionId,
        status: result.status,
        failureCode: result.failureCode,
        error: cataloged.error,
        message: cataloged.message,
        balance: result.balance,
        idempotentReplay: result.idempotentReplay,
      };
    }

    if (result.status === WagerTransactionStatus.PENDING_REFERENCE) {
      return {
        transactionId: result.transactionId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      };
    }

    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance,
      idempotentReplay: result.idempotentReplay,
    };
  }

  @Get('wagering/transactions/:transactionId')
  @ApiOperation({ summary: 'Consulta uma transação de aposta pelo id interno.' })
  @ApiParam({ name: 'transactionId', example: 'd00a5ef4-d683-46bf-bff4-d7b8a3611a25' })
  @ApiResponse({ status: 200, description: 'Transação encontrada.' })
  @ApiResponse({ status: 404, description: 'Transação não encontrada.' })
  async findOne(@Param() params: TransactionIdParamDto) {
    return this.getWagerTransaction.execute({ transactionId: params.transactionId });
  }
}
