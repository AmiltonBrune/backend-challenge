export interface WagerTransactionMetricInput {
  readonly kind: string;
  readonly status: string;
  readonly provider: string;
}

export interface ProviderMetricInput {
  readonly provider: string;
}

export interface RejectionMetricInput {
  readonly failureCode: string;
}

export interface HttpRequestDurationInput {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationSeconds: number;
}

export interface OutboxPublishMetricInput {
  readonly status: 'published' | 'failed';
}

export interface MetricsExposition {
  readonly contentType: string;
  readonly body: string;
}

export interface MetricsPort {
  recordWagerTransaction(input: WagerTransactionMetricInput): void;
  recordIdempotentReplay(input: ProviderMetricInput): void;
  recordIdempotencyConflict(input: ProviderMetricInput): void;
  recordRejection(input: RejectionMetricInput): void;
  observeHttpRequestDuration(input: HttpRequestDurationInput): void;
  recordOutboxPublish(input: OutboxPublishMetricInput): void;
  exposition(): Promise<MetricsExposition>;
}

export const METRICS_PORT = Symbol('MetricsPort');
