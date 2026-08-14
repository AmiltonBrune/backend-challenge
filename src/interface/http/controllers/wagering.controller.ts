import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
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

@Controller()
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getWagerTransaction: GetWagerTransactionUseCase,
    @Inject(METRICS_PORT) private readonly metrics: MetricsPort,
  ) {}

  @Post('wagering/transactions')
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
  async findOne(@Param() params: TransactionIdParamDto) {
    return this.getWagerTransaction.execute({ transactionId: params.transactionId });
  }
}
