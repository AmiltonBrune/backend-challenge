export interface ConsumerConfig {
  readonly queueUrl: string;
  readonly dlqUrl: string;
  readonly consumerName: string;
  readonly visibilityTimeoutSeconds: number;
  readonly maxMessages: number;
}

export interface WorkerConfig {
  readonly eventsQueueUrl: string;
  readonly outboxPollIntervalMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxAttempts: number;
  readonly pendingReferencePollIntervalMs: number;
  readonly pendingReferenceMaxAttempts: number;
  readonly pendingReferenceTtlHours: number;
}

export interface AppConfig {
  readonly port: number;
  readonly metricsPort: number;
  readonly databaseUrl: string;
  readonly dbPoolSize: number;
  readonly dbStatementTimeoutMs: number;
  readonly awsEndpointUrl: string;
  readonly awsRegion: string;
  readonly awsAccessKeyId: string;
  readonly awsSecretAccessKey: string;
  readonly logLevel: string;
  readonly consumer: ConsumerConfig | undefined;
  readonly worker: WorkerConfig | undefined;
}
