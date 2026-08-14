import { describe, expect, it } from 'bun:test';
import { PrometheusMetricsAdapter } from '@infrastructure/observability/prometheus-metrics.ts';

describe('PrometheusMetricsAdapter', () => {
  it('expõe o formato texto do Prometheus com content-type correto', async () => {
    const metrics = new PrometheusMetricsAdapter();

    const { contentType, body } = await metrics.exposition();

    expect(contentType).toContain('text/plain');
    expect(typeof body).toBe('string');
  });

  it('incrementa wager_transactions_total com os labels kind, status e provider', async () => {
    const metrics = new PrometheusMetricsAdapter();

    metrics.recordWagerTransaction({ kind: 'BET', status: 'PROCESSED', provider: 'provider-a' });

    const { body } = await metrics.exposition();
    expect(body).toContain('wager_transactions_total{kind="BET",status="PROCESSED",provider="provider-a"} 1');
  });

  it('acumula múltiplas transações com os mesmos labels', async () => {
    const metrics = new PrometheusMetricsAdapter();

    metrics.recordWagerTransaction({ kind: 'BET', status: 'PROCESSED', provider: 'provider-a' });
    metrics.recordWagerTransaction({ kind: 'BET', status: 'PROCESSED', provider: 'provider-a' });

    const { body } = await metrics.exposition();
    expect(body).toContain('wager_transactions_total{kind="BET",status="PROCESSED",provider="provider-a"} 2');
  });

  it('incrementa wager_idempotent_replays_total com o label provider', async () => {
    const metrics = new PrometheusMetricsAdapter();

    metrics.recordIdempotentReplay({ provider: 'provider-a' });

    const { body } = await metrics.exposition();
    expect(body).toContain('wager_idempotent_replays_total{provider="provider-a"} 1');
  });

  it('incrementa wager_idempotency_conflicts_total com o label provider', async () => {
    const metrics = new PrometheusMetricsAdapter();

    metrics.recordIdempotencyConflict({ provider: 'provider-a' });

    const { body } = await metrics.exposition();
    expect(body).toContain('wager_idempotency_conflicts_total{provider="provider-a"} 1');
  });

  it('incrementa wager_rejections_total com o label failure_code', async () => {
    const metrics = new PrometheusMetricsAdapter();

    metrics.recordRejection({ failureCode: 'INSUFFICIENT_FUNDS' });

    const { body } = await metrics.exposition();
    expect(body).toContain('wager_rejections_total{failure_code="INSUFFICIENT_FUNDS"} 1');
  });

  it('registra a duração da requisição HTTP no histograma por endpoint', async () => {
    const metrics = new PrometheusMetricsAdapter();

    metrics.observeHttpRequestDuration({
      method: 'POST',
      route: '/wagering/transactions',
      statusCode: 201,
      durationSeconds: 0.042,
    });

    const { body } = await metrics.exposition();
    expect(body).toContain('http_request_duration_seconds_count{method="POST",route="/wagering/transactions",status_code="201"} 1');
  });

  it('isola métricas entre instâncias distintas do adapter', async () => {
    const first = new PrometheusMetricsAdapter();
    const second = new PrometheusMetricsAdapter();

    first.recordWagerTransaction({ kind: 'BET', status: 'PROCESSED', provider: 'provider-a' });

    const { body } = await second.exposition();
    expect(body).not.toContain('wager_transactions_total{kind="BET"');
  });
});
