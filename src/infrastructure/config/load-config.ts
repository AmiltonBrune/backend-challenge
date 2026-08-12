import type { AppConfig, ConsumerConfig, WorkerConfig } from './app-config.ts';
import type { AppRole } from '../bootstrap/app-role.ts';

type Env = Record<string, string | undefined>;

class RequiredVarCollector {
  private readonly missing: string[] = [];

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
    return value === undefined || value === '' ? fallback : Number(value);
  }

  assertNoneMissing(): void {
    if (this.missing.length > 0) {
      throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${this.missing.join(', ')}`);
    }
  }
}

function loadConsumerConfig(env: Env): ConsumerConfig {
  const collector = new RequiredVarCollector(env);

  const queueUrl = collector.require('SQS_QUEUE_URL');
  const dlqUrl = collector.require('SQS_DLQ_URL');
  const consumerName = collector.require('CONSUMER_NAME');
  const visibilityTimeoutSeconds = collector.optionalInt('SQS_VISIBILITY_TIMEOUT_S', 30);
  const maxMessages = collector.optionalInt('SQS_MAX_MESSAGES', 10);

  collector.assertNoneMissing();

  return { queueUrl, dlqUrl, consumerName, visibilityTimeoutSeconds, maxMessages };
}

function loadWorkerConfig(env: Env): WorkerConfig {
  const collector = new RequiredVarCollector(env);

  const eventsQueueUrl = collector.require('EVENTS_QUEUE_URL');
  const outboxPollIntervalMs = collector.optionalInt('OUTBOX_POLL_INTERVAL_MS', 500);
  const outboxBatchSize = collector.optionalInt('OUTBOX_BATCH_SIZE', 50);
  const outboxMaxAttempts = collector.optionalInt('OUTBOX_MAX_ATTEMPTS', 10);
  const pendingReferencePollIntervalMs = collector.optionalInt(
    'PENDING_REFERENCE_POLL_INTERVAL_MS',
    5000,
  );
  const pendingReferenceMaxAttempts = collector.optionalInt('PENDING_REFERENCE_MAX_ATTEMPTS', 8);
  const pendingReferenceTtlHours = collector.optionalInt('PENDING_REFERENCE_TTL_HOURS', 24);

  collector.assertNoneMissing();

  return {
    eventsQueueUrl,
    outboxPollIntervalMs,
    outboxBatchSize,
    outboxMaxAttempts,
    pendingReferencePollIntervalMs,
    pendingReferenceMaxAttempts,
    pendingReferenceTtlHours,
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

  collector.assertNoneMissing();

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
    consumer: role === 'consumer' ? loadConsumerConfig(env) : undefined,
    worker: role === 'worker' ? loadWorkerConfig(env) : undefined,
  };
}
