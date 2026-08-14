import { describe, expect, it } from 'bun:test';
import type { MetricsExposition, MetricsPort } from '@application/ports/metrics-port.ts';
import { MetricsController } from '@interface/http/controllers/metrics.controller.ts';

function fakeMetricsPort(exposition: MetricsExposition): MetricsPort {
  return {
    recordWagerTransaction: () => {},
    recordIdempotentReplay: () => {},
    recordIdempotencyConflict: () => {},
    recordRejection: () => {},
    observeHttpRequestDuration: () => {},
    recordOutboxPublish: () => {},
    exposition: async () => exposition,
  };
}

interface FakeResponse {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

describe('MetricsController', () => {
  it('GET /metrics retorna o corpo em texto e o content-type do Prometheus', async () => {
    const exposition: MetricsExposition = {
      contentType: 'text/plain; version=0.0.4; charset=utf-8',
      body: 'wager_transactions_total{kind="BET",status="PROCESSED",provider="provider-a"} 1\n',
    };
    const controller = new MetricsController(fakeMetricsPort(exposition));
    const response = fakeResponse();

    const body = await controller.metricsExposition(response as never);

    expect(body).toBe(exposition.body);
    expect(response.headers['Content-Type']).toBe(exposition.contentType);
  });
});
