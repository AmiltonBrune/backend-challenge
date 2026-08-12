import { describe, expect, it } from 'bun:test';
import { loadConfig } from '@infrastructure/config/load-config.ts';

const commonEnv = {
  DATABASE_URL: 'postgres://wagering:wagering@localhost:5432/wagering',
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
};

describe('loadConfig — comuns a todo papel', () => {
  it('carrega com sucesso quando todas as obrigatorias comuns estao presentes', () => {
    const config = loadConfig({ ...commonEnv }, 'api');

    expect(config.databaseUrl).toBe(commonEnv.DATABASE_URL);
    expect(config.awsEndpointUrl).toBe(commonEnv.AWS_ENDPOINT_URL);
  });

  it('rejeita quando DATABASE_URL esta ausente', () => {
    const { DATABASE_URL, ...rest } = commonEnv;
    expect(() => loadConfig(rest, 'api')).toThrow(/DATABASE_URL/);
  });

  it('lista todas as variaveis ausentes de uma vez, nao so a primeira', () => {
    expect(() => loadConfig({}, 'api')).toThrow(
      /DATABASE_URL.*AWS_ENDPOINT_URL.*AWS_REGION.*AWS_ACCESS_KEY_ID.*AWS_SECRET_ACCESS_KEY/s,
    );
  });

  it('aplica defaults para variaveis opcionais ausentes', () => {
    const config = loadConfig({ ...commonEnv }, 'api');

    expect(config.port).toBe(3000);
    expect(config.dbPoolSize).toBe(10);
    expect(config.logLevel).toBe('info');
  });

  it('converte variaveis numericas para number, nunca string', () => {
    const config = loadConfig({ ...commonEnv, PORT: '4000', DB_POOL_SIZE: '25' }, 'api');

    expect(config.port).toBe(4000);
    expect(config.dbPoolSize).toBe(25);
  });

  it('rejeita variavel numerica nao numerica', () => {
    expect(() => loadConfig({ ...commonEnv, PORT: 'abc' }, 'api')).toThrow(/PORT/);
  });

  it('rejeita variavel numerica infinita', () => {
    expect(() => loadConfig({ ...commonEnv, DB_POOL_SIZE: 'Infinity' }, 'api')).toThrow(
      /DB_POOL_SIZE/,
    );
  });

  it('rejeita variavel numerica fracionaria', () => {
    expect(() => loadConfig({ ...commonEnv, PORT: '3000.5' }, 'api')).toThrow(/PORT/);
  });
});

describe('loadConfig — papel api', () => {
  it('nao exige variaveis de consumer nem de worker', () => {
    expect(() => loadConfig({ ...commonEnv }, 'api')).not.toThrow();
  });
});

describe('loadConfig — papel consumer', () => {
  const consumerEnv = {
    ...commonEnv,
    SQS_QUEUE_URL: 'http://localhost:4566/000000000000/wager-transactions.fifo',
    SQS_DLQ_URL: 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo',
    CONSUMER_NAME: 'wager-consumer',
  };

  it('carrega com sucesso quando as obrigatorias de consumer estao presentes', () => {
    const config = loadConfig({ ...consumerEnv }, 'consumer');

    expect(config.consumer?.queueUrl).toBe(consumerEnv.SQS_QUEUE_URL);
    expect(config.consumer?.consumerName).toBe(consumerEnv.CONSUMER_NAME);
  });

  it('rejeita quando SQS_QUEUE_URL esta ausente', () => {
    const { SQS_QUEUE_URL, ...rest } = consumerEnv;
    expect(() => loadConfig(rest, 'consumer')).toThrow(/SQS_QUEUE_URL/);
  });

  it('rejeita quando CONSUMER_NAME esta ausente', () => {
    const { CONSUMER_NAME, ...rest } = consumerEnv;
    expect(() => loadConfig(rest, 'consumer')).toThrow(/CONSUMER_NAME/);
  });

  it('lista variaveis comuns e de consumer ausentes na mesma falha', () => {
    expect(() => loadConfig({}, 'consumer')).toThrow(/DATABASE_URL.*SQS_QUEUE_URL/s);
  });
});

describe('loadConfig — papel worker', () => {
  const workerEnv = {
    ...commonEnv,
    EVENTS_QUEUE_URL: 'http://localhost:4566/000000000000/wager-events',
  };

  it('carrega com sucesso quando as obrigatorias de worker estao presentes', () => {
    const config = loadConfig({ ...workerEnv }, 'worker');

    expect(config.worker?.eventsQueueUrl).toBe(workerEnv.EVENTS_QUEUE_URL);
  });

  it('rejeita quando EVENTS_QUEUE_URL esta ausente', () => {
    const { EVENTS_QUEUE_URL, ...rest } = workerEnv;
    expect(() => loadConfig(rest, 'worker')).toThrow(/EVENTS_QUEUE_URL/);
  });

  it('aplica defaults de outbox e pending-reference quando ausentes', () => {
    const config = loadConfig({ ...workerEnv }, 'worker');

    expect(config.worker?.outboxPollIntervalMs).toBe(500);
    expect(config.worker?.outboxBatchSize).toBe(50);
    expect(config.worker?.pendingReferenceMaxAttempts).toBe(8);
  });

  it('lista variaveis comuns e de worker ausentes na mesma falha', () => {
    expect(() => loadConfig({}, 'worker')).toThrow(/DATABASE_URL.*EVENTS_QUEUE_URL/s);
  });
});
