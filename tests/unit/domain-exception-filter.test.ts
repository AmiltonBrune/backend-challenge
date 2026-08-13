import { describe, expect, it } from 'bun:test';
import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { WalletNotFoundError } from '@domain/errors/wallet-not-found-error.ts';
import { InsufficientFundsError } from '@domain/errors/insufficient-funds-error.ts';
import {
  ConcurrentIdempotencyProcessingError,
  ExternalTransactionConflictError,
  IdempotencyPayloadConflictError,
  InvalidCursorError,
  InvalidPaginationLimitError,
  WagerTransactionNotFoundError,
  WalletAlreadyExistsError,
} from '@application/errors/index.ts';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';

interface FakeResponse {
  statusCode: number | undefined;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): this;
  setHeader(name: string, value: string): this;
  json(body: unknown): this;
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: undefined,
    body: undefined,
    headers: {},
    status(code) {
      response.statusCode = code;
      return response;
    },
    setHeader(name, value) {
      response.headers[name] = value;
      return response;
    },
    json(body) {
      response.body = body;
      return response;
    },
  };
  return response;
}

function hostFor(response: FakeResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
      getNext: () => undefined,
    }),
    switchToRpc: () => {
      throw new Error('não usado');
    },
    switchToWs: () => {
      throw new Error('não usado');
    },
    getArgs: () => [],
    getArgByIndex: () => undefined,
    getType: () => 'http',
  } as unknown as ArgumentsHost;
}

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter();

  it('repassa HttpException já lançadas sem reinterpretar', () => {
    const response = fakeResponse();
    filter.catch(new BadRequestException({ error: 'ERR-009', message: 'obrigatório' }), hostFor(response));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'ERR-009', message: 'obrigatório' });
  });

  it('mapeia WalletNotFoundError para 404 com ERR-006', () => {
    const response = fakeResponse();
    filter.catch(new WalletNotFoundError('wallet-1'), hostFor(response));

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'ERR-006', message: 'Carteira não encontrada.' });
  });

  it('mapeia WagerTransactionNotFoundError para 404 com ERR-024', () => {
    const response = fakeResponse();
    filter.catch(new WagerTransactionNotFoundError('tx-1'), hostFor(response));

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'ERR-024', message: 'Operação não encontrada.' });
  });

  it('mapeia WalletAlreadyExistsError para 409 com ERR-004', () => {
    const response = fakeResponse();
    filter.catch(new WalletAlreadyExistsError('player-1', 'BRL'), hostFor(response));

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'ERR-004',
      message: 'Já existe carteira para este jogador nesta moeda.',
    });
  });

  it('mapeia IdempotencyPayloadConflictError para 409 com ERR-013', () => {
    const response = fakeResponse();
    filter.catch(new IdempotencyPayloadConflictError('provider-a', 'key-1'), hostFor(response));

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'ERR-013',
      message: 'Chave já utilizada com conteúdo diferente.',
    });
  });

  it('mapeia ExternalTransactionConflictError para 409 genérico de conflito', () => {
    const response = fakeResponse();
    filter.catch(
      new ExternalTransactionConflictError('provider-a', 'ext-1'),
      hostFor(response),
    );

    expect(response.statusCode).toBe(409);
    expect((response.body as { error: string }).error).toBe('CONFLICT');
  });

  it('mapeia ConcurrentIdempotencyProcessingError para 409 genérico de conflito', () => {
    const response = fakeResponse();
    filter.catch(
      new ConcurrentIdempotencyProcessingError('provider-a', 'key-1'),
      hostFor(response),
    );

    expect(response.statusCode).toBe(409);
    expect((response.body as { error: string }).error).toBe('CONFLICT');
  });

  it('mapeia InvalidCursorError para 400 com ERR-007', () => {
    const response = fakeResponse();
    filter.catch(new InvalidCursorError('lixo'), hostFor(response));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'ERR-007',
      message: 'Posição de continuação inválida.',
    });
  });

  it('mapeia InvalidPaginationLimitError para 400 com ERR-008', () => {
    const response = fakeResponse();
    filter.catch(new InvalidPaginationLimitError(500), hostFor(response));

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: 'ERR-008', message: 'Limite fora do intervalo permitido.' });
  });

  it('mapeia qualquer BusinessRuleViolationError não tratada para 422 com o failureCode', () => {
    const response = fakeResponse();
    filter.catch(new InsufficientFundsError('50.00', '10.00', 'BRL'), hostFor(response));

    expect(response.statusCode).toBe(422);
    expect(response.body).toEqual({
      failureCode: FailureCode.INSUFFICIENT_FUNDS,
      error: 'ERR-014',
      message: 'Saldo insuficiente para a operação solicitada.',
    });
  });

  it('mapeia falha de conexão de infraestrutura para 503 com Retry-After', () => {
    const response = fakeResponse();
    const infraError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    filter.catch(infraError, hostFor(response));

    expect(response.statusCode).toBe(503);
    expect(response.headers['Retry-After']).toBeDefined();
    expect(response.body).toEqual({
      error: 'ERR-503',
      message: 'Serviço temporariamente indisponível.',
    });
  });

  it('mapeia qualquer outro erro não previsto para 500', () => {
    const response = fakeResponse();
    filter.catch(new Error('algo inesperado'), hostFor(response));

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: 'ERR-500', message: 'Erro interno.' });
  });
});
