import { afterEach, describe, expect, it } from 'bun:test';
import { startMetricsHttpServer } from '@infrastructure/observability/metrics-http-server.ts';
import type { MetricsHttpServer } from '@infrastructure/observability/metrics-http-server.ts';
import type { MetricsExposition, MetricsPort } from '@application/ports/metrics-port.ts';

class FakeMetrics implements MetricsPort {
  recordWagerTransaction(): void {}
  recordIdempotentReplay(): void {}
  recordIdempotencyConflict(): void {}
  recordRejection(): void {}
  observeHttpRequestDuration(): void {}
  recordOutboxPublish(): void {}

  async exposition(): Promise<MetricsExposition> {
    return { contentType: 'text/plain; version=0.0.4', body: 'fake_metric_total 1\n' };
  }
}

let server: MetricsHttpServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('startMetricsHttpServer', () => {
  it('expõe a exposição do MetricsPort em GET /metrics', async () => {
    server = startMetricsHttpServer(0, new FakeMetrics());

    const response = await fetch(`http://127.0.0.1:${server.port}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('fake_metric_total 1');
  });

  it('responde 404 para outras rotas', async () => {
    server = startMetricsHttpServer(0, new FakeMetrics());

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);

    expect(response.status).toBe(404);
  });
});
