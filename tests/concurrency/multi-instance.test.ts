import { afterAll, beforeAll, expect, it } from 'bun:test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const sqsEndpoint = 'http://localhost:54566';
const instanceCount = 3;
const basePort = 4101;

interface StartingGate {
  arrive(): Promise<void>;
  readonly allArrived: Promise<void>;
  release(): void;
}

function startingGate(count: number): StartingGate {
  let arrived = 0;
  let resolveAllArrived: () => void = () => {};
  const allArrived = new Promise<void>((resolve) => {
    resolveAllArrived = resolve;
  });
  let resolveGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  return {
    arrive(): Promise<void> {
      arrived += 1;
      if (arrived === count) {
        resolveAllArrived();
      }
      return gate;
    },
    allArrived,
    release: resolveGate,
  };
}

interface Instance {
  readonly port: number;
  readonly baseUrl: string;
  readonly process: ReturnType<typeof Bun.spawn>;
}

const instances: Instance[] = [];

function instanceForRequest(index: number): Instance {
  return instances[index % instances.length] as Instance;
}

async function waitUntilHealthy(baseUrl: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health/live`);
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`instância em ${baseUrl} não ficou saudável a tempo: ${String(lastError)}`);
}

async function openWallet(baseUrl: string, playerId: string, initialBalance: string): Promise<string> {
  const response = await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: initialBalance, currency: 'BRL' } }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function reconcile(baseUrl: string, walletId: string): Promise<{ consistent: boolean }> {
  const response = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  return (await response.json()) as { consistent: boolean };
}

describeIfDocker('T-065 — três ou mais processos reais e separados, sem estado compartilhado em memória', () => {
  beforeAll(async () => {
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test', 'localstack-test']);

    process.env['DATABASE_URL'] = databaseUrl;
    const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.destroy();

    const env = {
      ...process.env,
      APP_ROLE: 'api',
      DATABASE_URL: databaseUrl,
      DB_POOL_SIZE: '5',
      AWS_ENDPOINT_URL: sqsEndpoint,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      LOG_LEVEL: 'error',
    };

    for (let index = 0; index < instanceCount; index += 1) {
      const port = basePort + index;
      const child = Bun.spawn(['bun', 'run', 'src/main.ts'], {
        env: { ...env, PORT: String(port) },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      instances.push({ port, baseUrl: `http://127.0.0.1:${port}`, process: child });
    }

    await Promise.all(instances.map((instance) => waitUntilHealthy(instance.baseUrl, 30_000)));
  }, 60_000);

  afterAll(async () => {
    for (const instance of instances) {
      instance.process.kill();
    }
    await Promise.all(instances.map((instance) => instance.process.exited));
    await runDockerCompose(['down', '-v']);
  }, 30_000);

  it('confirma que são processos distintos, cada um com seu próprio PID', () => {
    const pids = new Set(instances.map((instance) => instance.process.pid));
    expect(pids.size).toBe(instanceCount);
  });

  it('a mesma aposta enviada 50x em paralelo, distribuída entre 3 instâncias reais, produz exatamente um débito', async () => {
    const playerId = crypto.randomUUID();
    const walletId = await openWallet(instances[0]!.baseUrl, playerId, '1000.00');
    const idempotencyKey = crypto.randomUUID();
    const externalTransactionId = crypto.randomUUID();
    const concurrency = 50;

    const gate = startingGate(concurrency);
    const requestPromises = Array.from({ length: concurrency }, (_, index) =>
      gate.arrive().then(() => {
        const instance = instanceForRequest(index);
        return fetch(`${instance.baseUrl}/wagering/transactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
          body: JSON.stringify({
            providerId: 'provider-a',
            externalTransactionId,
            playerId,
            walletId,
            roundId: 'round-1',
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: '10.00', currency: 'BRL' },
          }),
        });
      }),
    );

    await gate.allArrived;
    gate.release();
    const responses = await Promise.all(requestPromises);
    const bodies = await Promise.all(
      responses.map((response) => response.json() as Promise<{ idempotentReplay: boolean; status: string }>),
    );

    const nonReplays = bodies.filter((body) => body.idempotentReplay === false);
    expect(nonReplays).toHaveLength(1);
    expect(nonReplays[0]?.status).toBe('PROCESSED');

    const ledgerResponse = await fetch(`${instances[0]!.baseUrl}/wallets/${walletId}/ledger`);
    const ledgerBody = (await ledgerResponse.json()) as { entries: unknown[] };
    expect(ledgerBody.entries).toHaveLength(2);

    const walletResponse = await fetch(`${instances[1]!.baseUrl}/wallets/${walletId}`);
    const walletBody = (await walletResponse.json()) as { balance: { amount: string } };
    expect(walletBody.balance.amount).toBe('990.00');

    const reconciliation = await reconcile(instances[2]!.baseUrl, walletId);
    expect(reconciliation.consistent).toBe(true);
  }, 30_000);

  it('saldo 100, duas apostas de 80 enviadas para instâncias diferentes: uma processa, uma rejeita', async () => {
    const playerId = crypto.randomUUID();
    const walletId = await openWallet(instances[0]!.baseUrl, playerId, '100.00');

    const gate = startingGate(2);
    const requestPromises = [0, 1].map((index) =>
      gate.arrive().then(() => {
        const instance = instanceForRequest(index);
        return fetch(`${instance.baseUrl}/wagering/transactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            providerId: 'provider-a',
            externalTransactionId: crypto.randomUUID(),
            playerId,
            walletId,
            roundId: 'round-1',
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: '80.00', currency: 'BRL' },
          }),
        });
      }),
    );

    await gate.allArrived;
    gate.release();
    const responses = await Promise.all(requestPromises);
    const bodies = await Promise.all(
      responses.map((response) => response.json() as Promise<{ status: string; failureCode?: string }>),
    );

    const processed = bodies.filter((body) => body.status === 'PROCESSED');
    const rejected = bodies.filter((body) => body.status === 'REJECTED');
    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.failureCode).toBe('INSUFFICIENT_FUNDS');

    const walletResponse = await fetch(`${instances[2]!.baseUrl}/wallets/${walletId}`);
    const walletBody = (await walletResponse.json()) as { balance: { amount: string } };
    expect(walletBody.balance.amount).toBe('20.00');

    const reconciliation = await reconcile(instances[1]!.baseUrl, walletId);
    expect(reconciliation.consistent).toBe(true);
  }, 30_000);
});
