import { describe, expect, it } from 'bun:test';
import { of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { HttpRequestDurationInput, MetricsPort } from '@application/ports/metrics-port.ts';
import { HttpMetricsInterceptor } from '@interface/http/interceptors/http-metrics.interceptor.ts';

function fakeMetricsPort(): { metrics: MetricsPort; observed: HttpRequestDurationInput[] } {
  const observed: HttpRequestDurationInput[] = [];
  const metrics: MetricsPort = {
    recordWagerTransaction: () => {},
    recordIdempotentReplay: () => {},
    recordIdempotencyConflict: () => {},
    recordRejection: () => {},
    observeHttpRequestDuration: (input) => {
      observed.push(input);
    },
    exposition: async () => ({ contentType: '', body: '' }),
  };
  return { metrics, observed };
}

function fakeContext(method: string, url: string, statusCode: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url, route: undefined }),
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

function fakeCallHandler(result: unknown, shouldThrow = false): CallHandler {
  return {
    handle: () => (shouldThrow ? throwError(() => result) : of(result)),
  };
}

describe('HttpMetricsInterceptor', () => {
  it('registra a duração da requisição bem-sucedida com método, rota e status', async () => {
    const { metrics, observed } = fakeMetricsPort();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const context = fakeContext('POST', '/wagering/transactions', 201);

    await new Promise<void>((resolve) => {
      interceptor.intercept(context, fakeCallHandler({ ok: true })).subscribe({
        complete: resolve,
      });
    });

    expect(observed.length).toBe(1);
    expect(observed[0]?.method).toBe('POST');
    expect(observed[0]?.route).toBe('/wagering/transactions');
    expect(observed[0]?.statusCode).toBe(201);
    expect(observed[0]?.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('registra a duração mesmo quando o handler propaga um erro', async () => {
    const { metrics, observed } = fakeMetricsPort();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const context = fakeContext('POST', '/wagering/transactions', 422);

    await new Promise<void>((resolve) => {
      interceptor.intercept(context, fakeCallHandler(new Error('falhou'), true)).subscribe({
        error: () => resolve(),
      });
    });

    expect(observed.length).toBe(1);
    expect(observed[0]?.statusCode).toBe(422);
  });
});
