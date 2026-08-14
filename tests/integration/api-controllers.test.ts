import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const composeArgs = ['-f', 'docker-compose.test.yml'] as const;

async function dockerComposeAvailable(): Promise<boolean> {
  try {
    const child = Bun.spawn(['docker', 'compose', 'version'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await child.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function runDockerCompose(args: readonly string[]): Promise<void> {
  const child = Bun.spawn(['docker', 'compose', ...composeArgs, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(`docker compose ${args.join(' ')} falhou: ${stderr}`);
  }
}

const hasDockerCompose = await dockerComposeAvailable();
const describeIfDocker = hasDockerCompose ? describe : describe.skip;

let app: INestApplication | undefined;
let baseUrl: string;

function api(): string {
  return baseUrl;
}

describeIfDocker('Superfície HTTP — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    process.env['AWS_ENDPOINT_URL'] = 'http://localhost:54566';
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_ACCESS_KEY_ID'] = 'test';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);

    const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.destroy();

    const { ApiModule } = await import('@infrastructure/bootstrap/roles/api.module.ts');
    app = await NestFactory.create(ApiModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    try {
      if (app !== undefined) {
        await app.close();
      }
    } finally {
      await runDockerCompose(['down', '-v']);
    }
  }, 30_000);

  it('POST /wallets abre uma carteira e retorna 201', async () => {
    const playerId = crypto.randomUUID();
    const response = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '1000.00', currency: 'BRL' } }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; balance: { amount: string }; version: number };
    expect(body.balance.amount).toBe('1000.00');
    expect(body.version).toBe(1);
  });

  it('POST /wallets rejeita playerId ausente com 400', async () => {
    const response = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initialBalance: { amount: '10.00', currency: 'BRL' } }),
    });

    expect(response.status).toBe(400);
  });

  it('GET /wallets/:walletId retorna a carteira criada', async () => {
    const playerId = crypto.randomUUID();
    const created = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '500.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await created.json()) as { id: string };

    const response = await fetch(`${api()}/wallets/${walletId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; balance: { amount: string } };
    expect(body.id).toBe(walletId);
    expect(body.balance.amount).toBe('500.00');
  });

  it('GET /wallets/:walletId retorna 404 com ERR-006 para carteira inexistente', async () => {
    const response = await fetch(`${api()}/wallets/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ERR-006');
  });

  it('POST /wallets rejeita playerId duplicado na mesma moeda com 409', async () => {
    const playerId = crypto.randomUUID();
    const payload = JSON.stringify({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } });

    await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });

    const response = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ERR-004');
  });

  it('GET /wagering/transactions/:transactionId retorna 404 com ERR-024 para transação inexistente', async () => {
    const response = await fetch(`${api()}/wagering/transactions/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ERR-024');
  });

  it('POST /wagering/transactions processa uma aposta e retorna 201', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    const response = await fetch(`${api()}/wagering/transactions`, {
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
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { status: string; balance: { amount: string } };
    expect(body.status).toBe('PROCESSED');
    expect(body.balance.amount).toBe('75.00');
  });

  it('POST /wagering/transactions sem Idempotency-Key retorna 400', async () => {
    const response = await fetch(`${api()}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'provider-a',
        externalTransactionId: crypto.randomUUID(),
        playerId: crypto.randomUUID(),
        walletId: crypto.randomUUID(),
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    expect(response.status).toBe(400);
  });

  it('POST /wagering/transactions rejeita saldo insuficiente com 422', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    const response = await fetch(`${api()}/wagering/transactions`, {
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
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { failureCode: string; error: string };
    expect(body.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(body.error).toBe('ERR-014');
  });

  it('GET /wagering/transactions/:transactionId retorna a transação', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    const betResponse = await fetch(`${api()}/wagering/transactions`, {
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
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });
    const { transactionId } = (await betResponse.json()) as { transactionId: string };

    const response = await fetch(`${api()}/wagering/transactions/${transactionId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { transactionId: string; gameId: string };
    expect(body.transactionId).toBe(transactionId);
    expect(body.gameId).toBe('game-1');
  });

  it('GET /providers/:providerId/wagering/transactions/:externalTransactionId retorna a transação', async () => {
    const playerId = crypto.randomUUID();
    const externalTransactionId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    await fetch(`${api()}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        providerId: 'provider-b',
        externalTransactionId,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    const response = await fetch(
      `${api()}/providers/provider-b/wagering/transactions/${externalTransactionId}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { externalTransactionId: string };
    expect(body.externalTransactionId).toBe(externalTransactionId);
  });

  it('GET /wallets/:walletId/ledger retorna os lançamentos paginados', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    await fetch(`${api()}/wagering/transactions`, {
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
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    const response = await fetch(`${api()}/wallets/${walletId}/ledger`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: unknown[]; hasMore: boolean };
    expect(body.entries).toHaveLength(2);
    expect(body.hasMore).toBe(false);
  });

  it('GET /wallets/:walletId/ledger percorre múltiplas páginas por cursor sem repetir nem pular lançamentos', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '1000.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    for (let index = 0; index < 5; index += 1) {
      await fetch(`${api()}/wagering/transactions`, {
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
          money: { amount: '10.00', currency: 'BRL' },
        }),
      });
    }

    const collectedIds: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const url = new URL(`${api()}/wallets/${walletId}/ledger`);
      url.searchParams.set('limit', '2');
      if (cursor !== undefined) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetch(url);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        entries: { id: string }[];
        nextCursor: string | undefined;
        hasMore: boolean;
      };

      collectedIds.push(...body.entries.map((entry) => entry.id));
      cursor = body.nextCursor;
      pages += 1;

      expect(body.hasMore).toBe(cursor !== undefined);
    } while (cursor !== undefined);

    expect(pages).toBe(3);
    expect(collectedIds).toHaveLength(6);
    expect(new Set(collectedIds).size).toBe(6);
  });

  it('GET /wallets/:walletId/ledger rejeita cursor corrompido com 400 ERR-007', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '10.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    const response = await fetch(`${api()}/wallets/${walletId}/ledger?cursor=lixo-invalido`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ERR-007');
  });

  it('POST /wallets/:walletId/reconciliation retorna consistent:true', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    const response = await fetch(`${api()}/wallets/${walletId}/reconciliation`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { consistent: boolean; checkedEntries: number };
    expect(body.consistent).toBe(true);
    expect(body.checkedEntries).toBe(1);
  });

  it('POST /wagering/transactions rejeita idempotency-key inválida com 400', async () => {
    const response = await fetch(`${api()}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': '' },
      body: JSON.stringify({
        providerId: 'provider-a',
        externalTransactionId: crypto.randomUUID(),
        playerId: crypto.randomUUID(),
        walletId: crypto.randomUUID(),
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    expect(response.status).toBe(400);
  });

  it('GET /metrics retorna 200 em texto Prometheus com wager_transactions_total após uma aposta', async () => {
    const playerId = crypto.randomUUID();
    const walletResponse = await fetch(`${api()}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const { id: walletId } = (await walletResponse.json()) as { id: string };

    await fetch(`${api()}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        providerId: 'provider-metrics',
        externalTransactionId: crypto.randomUUID(),
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });

    const response = await fetch(`${api()}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');

    const body = await response.text();
    expect(body).toContain('wager_transactions_total{kind="BET",status="PROCESSED",provider="provider-metrics"}');
    expect(body).toContain('http_request_duration_seconds');
  });

  it('propaga o X-Correlation-Id recebido de volta na resposta', async () => {
    const response = await fetch(`${api()}/wagering/transactions/${crypto.randomUUID()}`, {
      headers: { 'x-correlation-id': 'integration-corr-1' },
    });

    expect(response.headers.get('x-correlation-id')).toBe('integration-corr-1');
  });

  it('gera um X-Correlation-Id quando a requisição não envia um', async () => {
    const response = await fetch(`${api()}/wagering/transactions/${crypto.randomUUID()}`);

    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });
});
