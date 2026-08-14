import { describe, expect, it } from 'bun:test';
import type { Request, Response } from 'express';
import { CorrelationIdMiddleware } from '@infrastructure/observability/correlation-id.middleware.ts';
import { getCorrelationId } from '@infrastructure/observability/correlation-context.ts';

const CORRELATION_HEADER = 'x-correlation-id';

function fakeRequest(headerValue: string | undefined): Request {
  return {
    header: (name: string) => (name.toLowerCase() === CORRELATION_HEADER ? headerValue : undefined),
  } as unknown as Request;
}

function fakeResponse(): { response: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { response, headers };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('CorrelationIdMiddleware', () => {
  it('reutiliza o correlationId recebido no header da requisição', () => {
    const middleware = new CorrelationIdMiddleware();
    const request = fakeRequest('incoming-correlation-id');
    const { response, headers } = fakeResponse();
    let observed: string | undefined;

    middleware.use(request, response, () => {
      observed = getCorrelationId();
    });

    expect(observed).toBe('incoming-correlation-id');
    expect(headers[CORRELATION_HEADER]).toBe('incoming-correlation-id');
  });

  it('gera um novo correlationId quando o header está ausente', () => {
    const middleware = new CorrelationIdMiddleware();
    const request = fakeRequest(undefined);
    const { response, headers } = fakeResponse();
    let observed: string | undefined;

    middleware.use(request, response, () => {
      observed = getCorrelationId();
    });

    expect(observed).toBeDefined();
    expect(observed).toMatch(UUID_PATTERN);
    expect(headers[CORRELATION_HEADER]).toBe(observed);
  });

  it('gera um novo correlationId quando o header vem vazio', () => {
    const middleware = new CorrelationIdMiddleware();
    const request = fakeRequest('');
    const { response } = fakeResponse();
    let observed: string | undefined;

    middleware.use(request, response, () => {
      observed = getCorrelationId();
    });

    expect(observed).toMatch(UUID_PATTERN);
  });

  it('não vaza o correlationId para fora do next()', () => {
    const middleware = new CorrelationIdMiddleware();
    const request = fakeRequest('corr-x');
    const { response } = fakeResponse();

    middleware.use(request, response, () => {});

    expect(getCorrelationId()).toBeUndefined();
  });
});
