import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { BusinessRuleViolationError } from '@domain/errors/business-rule-violation-error.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import { IdempotencyPayloadConflictError } from '@application/errors/idempotency-payload-conflict-error.ts';
import { InvalidCursorError } from '@application/errors/invalid-cursor-error.ts';
import { InvalidPaginationLimitError } from '@application/errors/invalid-pagination-limit-error.ts';
import { PersistenceConflictError } from '@application/errors/persistence-conflict-error.ts';
import { WagerTransactionNotFoundError } from '@application/errors/wager-transaction-not-found-error.ts';
import { WalletAlreadyExistsError } from '@application/errors/wallet-already-exists-error.ts';
import { catalogFailureCode } from '@interface/http/error-catalog.ts';
import { isInfrastructureUnavailable } from '@interface/http/infrastructure-unavailable.ts';

const RETRY_AFTER_SECONDS = 5;

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof WalletNotFoundError) {
      response.status(404).json(catalogFailureCode(exception.failureCode));
      return;
    }

    if (exception instanceof WagerTransactionNotFoundError) {
      response.status(404).json({ error: 'ERR-024', message: 'Operação não encontrada.' });
      return;
    }

    if (exception instanceof WalletAlreadyExistsError) {
      response
        .status(409)
        .json({ error: 'ERR-004', message: 'Já existe carteira para este jogador nesta moeda.' });
      return;
    }

    if (exception instanceof IdempotencyPayloadConflictError) {
      response
        .status(409)
        .json({ error: 'ERR-013', message: 'Chave já utilizada com conteúdo diferente.' });
      return;
    }

    if (exception instanceof PersistenceConflictError) {
      response.status(409).json({ error: 'CONFLICT', message: exception.message });
      return;
    }

    if (exception instanceof InvalidCursorError) {
      response.status(400).json({ error: 'ERR-007', message: 'Posição de continuação inválida.' });
      return;
    }

    if (exception instanceof InvalidPaginationLimitError) {
      response.status(400).json({ error: 'ERR-008', message: 'Limite fora do intervalo permitido.' });
      return;
    }

    if (exception instanceof BusinessRuleViolationError) {
      response
        .status(422)
        .json({ failureCode: exception.failureCode, ...catalogFailureCode(exception.failureCode) });
      return;
    }

    if (isInfrastructureUnavailable(exception)) {
      response
        .status(503)
        .setHeader('Retry-After', String(RETRY_AFTER_SECONDS))
        .json({ error: 'ERR-503', message: 'Serviço temporariamente indisponível.' });
      return;
    }

    response.status(500).json({ error: 'ERR-500', message: 'Erro interno.' });
  }
}
