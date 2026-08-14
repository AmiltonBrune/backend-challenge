import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type {
  HttpRequestDurationInput,
  MetricsExposition,
  MetricsPort,
  OutboxPublishMetricInput,
  ProviderMetricInput,
  RejectionMetricInput,
  WagerTransactionMetricInput,
} from '@application/ports/metrics-port.ts';

export class PrometheusMetricsAdapter implements MetricsPort {
  private readonly registry: Registry;
  private readonly wagerTransactionsTotal: Counter<'kind' | 'status' | 'provider'>;
  private readonly idempotentReplaysTotal: Counter<'provider'>;
  private readonly idempotencyConflictsTotal: Counter<'provider'>;
  private readonly rejectionsTotal: Counter<'failure_code'>;
  private readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code'>;
  private readonly outboxMessagesPublishedTotal: Counter<'status'>;

  constructor(registry: Registry = new Registry()) {
    this.registry = registry;
    collectDefaultMetrics({ register: this.registry });

    this.wagerTransactionsTotal = new Counter({
      name: 'wager_transactions_total',
      help: 'Total de transações de aposta processadas, por tipo, status e provedor.',
      labelNames: ['kind', 'status', 'provider'],
      registers: [this.registry],
    });

    this.idempotentReplaysTotal = new Counter({
      name: 'wager_idempotent_replays_total',
      help: 'Total de respostas retornadas via replay de idempotência, por provedor.',
      labelNames: ['provider'],
      registers: [this.registry],
    });

    this.idempotencyConflictsTotal = new Counter({
      name: 'wager_idempotency_conflicts_total',
      help: 'Total de conflitos de idempotência (mesma chave, payload diferente), por provedor.',
      labelNames: ['provider'],
      registers: [this.registry],
    });

    this.rejectionsTotal = new Counter({
      name: 'wager_rejections_total',
      help: 'Total de transações rejeitadas, por failureCode.',
      labelNames: ['failure_code'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP em segundos, por método, rota e status.',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.outboxMessagesPublishedTotal = new Counter({
      name: 'outbox_messages_published_total',
      help: 'Total de mensagens do outbox publicadas na fila de eventos, por status.',
      labelNames: ['status'],
      registers: [this.registry],
    });
  }

  recordWagerTransaction(input: WagerTransactionMetricInput): void {
    this.wagerTransactionsTotal.inc({ kind: input.kind, status: input.status, provider: input.provider });
  }

  recordIdempotentReplay(input: ProviderMetricInput): void {
    this.idempotentReplaysTotal.inc({ provider: input.provider });
  }

  recordIdempotencyConflict(input: ProviderMetricInput): void {
    this.idempotencyConflictsTotal.inc({ provider: input.provider });
  }

  recordRejection(input: RejectionMetricInput): void {
    this.rejectionsTotal.inc({ failure_code: input.failureCode });
  }

  observeHttpRequestDuration(input: HttpRequestDurationInput): void {
    this.httpRequestDurationSeconds.observe(
      { method: input.method, route: input.route, status_code: String(input.statusCode) },
      input.durationSeconds,
    );
  }

  recordOutboxPublish(input: OutboxPublishMetricInput): void {
    this.outboxMessagesPublishedTotal.inc({ status: input.status });
  }

  async exposition(): Promise<MetricsExposition> {
    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }
}
