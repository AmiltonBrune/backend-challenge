import type { AppConfig, ConsumerConfig, WorkerConfig } from './app-config.ts';
import type { AppRole } from '../bootstrap/app-role.ts';

type Env = Record<string, string | undefined>;

class RequiredVarCollector {
  private readonly missing: string[] = [];
  private readonly invalid: string[] = [];

  constructor(private readonly env: Env) {}

  require(name: string): string {
    const value = this.env[name];
    if (value === undefined || value === '') {
      this.missing.push(name);
      return '';
    }
    return value;
  }

  optional(name: string, fallback: string): string {
    const value = this.env[name];
    return value === undefined || value === '' ? fallback : value;
  }

  optionalInt(name: string, fallback: number): number {
    const value = this.env[name];
    if (value === undefined || value === '') {
      return fallback;
    }
    return this.parseInt(name, value);
  }

  private parseInt(name: string, raw: string): number {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      this.invalid.push(name);
      return 0;
    }
    return parsed;
  }

  assertValid(): void {
    const problems: string[] = [];
    if (this.missing.length > 0) {
      problems.push(`ausentes: ${this.missing.join(', ')}`);
    }
    if (this.invalid.length > 0) {
      problems.push(`com valor numerico invalido: ${this.invalid.join(', ')}`);
    }
    if (problems.length > 0) {
      throw new Error(`Variáveis de ambiente obrigatórias ${problems.join('; ')}`);
    }
  }
}

function readConsumerConfig(collector: RequiredVarCollector): ConsumerConfig {
  return {
    queueUrl: collector.require('SQS_QUEUE_URL'),
    dlqUrl: collector.require('SQS_DLQ_URL'),
    consumerName: collector.require('CONSUMER_NAME'),
    visibilityTimeoutSeconds: collector.optionalInt('SQS_VISIBILITY_TIMEOUT_S', 30),
    maxMessages: collector.optionalInt('SQS_MAX_MESSAGES', 10),
  };
}

function readWorkerConfig(collector: RequiredVarCollector): WorkerConfig {
  return {
    eventsQueueUrl: collector.require('EVENTS_QUEUE_URL'),
    outboxPollIntervalMs: collector.optionalInt('OUTBOX_POLL_INTERVAL_MS', 500),
    outboxBatchSize: collector.optionalInt('OUTBOX_BATCH_SIZE', 50),
    outboxMaxAttempts: collector.optionalInt('OUTBOX_MAX_ATTEMPTS', 10),
    pendingReferencePollIntervalMs: collector.optionalInt(
      'PENDING_REFERENCE_POLL_INTERVAL_MS',
      5000,
    ),
    pendingReferenceMaxAttempts: collector.optionalInt('PENDING_REFERENCE_MAX_ATTEMPTS', 8),
    pendingReferenceTtlHours: collector.optionalInt('PENDING_REFERENCE_TTL_HOURS', 24),
  };
}

export function loadConfig(env: Env, role: AppRole): AppConfig {
  const collector = new RequiredVarCollector(env);

  const port = collector.optionalInt('PORT', 3000);
  const databaseUrl = collector.require('DATABASE_URL');
  const dbPoolSize = collector.optionalInt('DB_POOL_SIZE', 10);
  const dbStatementTimeoutMs = collector.optionalInt('DB_STATEMENT_TIMEOUT_MS', 5000);
  const awsEndpointUrl = collector.require('AWS_ENDPOINT_URL');
  const awsRegion = collector.require('AWS_REGION');
  const awsAccessKeyId = collector.require('AWS_ACCESS_KEY_ID');
  const awsSecretAccessKey = collector.require('AWS_SECRET_ACCESS_KEY');
  const logLevel = collector.optional('LOG_LEVEL', 'info');

  const consumer = role === 'consumer' ? readConsumerConfig(collector) : undefined;
  const worker = role === 'worker' ? readWorkerConfig(collector) : undefined;

  collector.assertValid();

  return {
    port,
    databaseUrl,
    dbPoolSize,
    dbStatementTimeoutMs,
    awsEndpointUrl,
    awsRegion,
    awsAccessKeyId,
    awsSecretAccessKey,
    logLevel,
    consumer,
    worker,
  };
}
