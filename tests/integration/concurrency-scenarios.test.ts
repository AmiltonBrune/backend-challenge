import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';
import { ProcessWagerTransactionUseCase } from '@application/use-cases/process-wager-transaction-use-case.ts';
import { SqsWagerTransactionConsumer } from '@workers/consumer/sqs-wager-transaction-consumer.ts';
import { describeIfDocker, runDockerCompose, waitForQueue } from '@tests/support/docker-compose-harness.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
const sqsEndpoint = 'http://localhost:54566';
const queueUrl = `${sqsEndpoint}/000000000000/wager-transactions.fifo`;
const dlqUrl = `${sqsEndpoint}/000000000000/wager-transactions-dlq.fifo`;

let app: INestApplication | undefined;
let baseUrl: string;
let sqsClient: SQSClient;

function api(): string {
  return baseUrl;
}

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

async function openWallet(playerId: string, initialBalance: string): Promise<string> {
  const response = await fetch(`${api()}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: initialBalance, currency: 'BRL' } }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function reconcile(walletId: string): Promise<{ consistent: boolean }> {
  const response = await fetch(`${api()}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  return (await response.json()) as { consistent: boolean };
}

interface WagerRequestInput {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: string;
  readonly money: { amount: string; currency: string };
  readonly referenceExternalTransactionId?: string;
  readonly idempotencyKey?: string;
}

async function postWager(input: WagerRequestInput): Promise<Response> {
  const { idempotencyKey, ...body } = input;
  return fetch(`${api()}/wagering/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey ?? crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

async function getWagerTransaction(transactionId: string): Promise<{ status: string }> {
  const response = await fetch(`${api()}/wagering/transactions/${transactionId}`);
  return (await response.json()) as { status: string };
}

async function buildPendingReferenceWorker() {
  const { AppDataSource } = await import('@infrastructure/persistence/data-source.ts');
  const { TypeOrmUnitOfWork } = await import(
    '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
  );
  const { TypeOrmWagerTransactionRepository } = await import(
    '@infrastructure/persistence/repositories/typeorm-wager-transaction-repository.ts'
  );
  const { SystemClock } = await import('@infrastructure/system-clock.ts');
  const { PendingReferenceRetryWorker } = await import(
    '@workers/pending-reference/pending-reference-retry-worker.ts'
  );

  return new PendingReferenceRetryWorker({
    unitOfWork: new TypeOrmUnitOfWork(AppDataSource),
    wagerTransactionRepository: new TypeOrmWagerTransactionRepository(),
    useCase: (app as INestApplication).get(ProcessWagerTransactionUseCase),
    clock: new SystemClock(),
    batchSize: 10,
    retryPolicy: { maxAttempts: 8, ttlHours: 24 },
  });
}

function flakyDeleteSqsClient(client: SQSClient, failuresBeforeSuccess: number): SQSClient {
  let remaining = failuresBeforeSuccess;
  return {
    send: (command: unknown) => {
      if (command instanceof DeleteMessageCommand && remaining > 0) {
        remaining -= 1;
        return Promise.reject(new Error('processo morto antes de confirmar a mensagem'));
      }
      return client.send(command as never);
    },
  } as unknown as SQSClient;
}

describeIfDocker('Cenários de concorrência real — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    process.env['AWS_ENDPOINT_URL'] = sqsEndpoint;
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_ACCESS_KEY_ID'] = 'test';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test', 'localstack-test']);

    sqsClient = new SQSClient({
      endpoint: sqsEndpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await waitForQueue(sqsClient, 'wager-transactions.fifo');
    await waitForQueue(sqsClient, 'wager-transactions-dlq.fifo');

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

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`T-063 — a mesma aposta enviada 50x em paralelo produz exatamente um débito (execução ${iteration}/3)`, async () => {
      const playerId = crypto.randomUUID();
      const walletId = await openWallet(playerId, '1000.00');
      const idempotencyKey = crypto.randomUUID();
      const externalTransactionId = crypto.randomUUID();
      const concurrency = 50;

      const gate = startingGate(concurrency);
      const requestPromises = Array.from({ length: concurrency }, () =>
        gate.arrive().then(() =>
          fetch(`${api()}/wagering/transactions`, {
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
          }),
        ),
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

      const ledgerResponse = await fetch(`${api()}/wallets/${walletId}/ledger`);
      const ledgerBody = (await ledgerResponse.json()) as { entries: unknown[] };
      expect(ledgerBody.entries).toHaveLength(2);

      const walletResponse = await fetch(`${api()}/wallets/${walletId}`);
      const walletBody = (await walletResponse.json()) as { balance: { amount: string } };
      expect(walletBody.balance.amount).toBe('990.00');

      const reconciliation = await reconcile(walletId);
      expect(reconciliation.consistent).toBe(true);
    }, 30_000);
  }

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`T-064 — saldo 100, duas apostas de 80 em paralelo: uma processa, uma rejeita (execução ${iteration}/3)`, async () => {
      const playerId = crypto.randomUUID();
      const walletId = await openWallet(playerId, '100.00');

      const gate = startingGate(2);
      const requestPromises = Array.from({ length: 2 }, () =>
        gate.arrive().then(() =>
          fetch(`${api()}/wagering/transactions`, {
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
          }),
        ),
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

      const walletResponse = await fetch(`${api()}/wallets/${walletId}`);
      const walletBody = (await walletResponse.json()) as { balance: { amount: string } };
      expect(walletBody.balance.amount).toBe('20.00');

      const ledgerResponse = await fetch(`${api()}/wallets/${walletId}/ledger`);
      const ledgerBody = (await ledgerResponse.json()) as { entries: unknown[] };
      expect(ledgerBody.entries).toHaveLength(2);

      const reconciliation = await reconcile(walletId);
      expect(reconciliation.consistent).toBe(true);
    }, 30_000);
  }

  it('T-069 — wallets distintas processadas em paralelo não esperam uma pela outra', async () => {
    const players = Array.from({ length: 5 }, () => crypto.randomUUID());
    const wallets = await Promise.all(players.map((playerId) => openWallet(playerId, '100.00')));

    const gate = startingGate(wallets.length);
    const requestPromises = wallets.map((walletId, index) =>
      gate.arrive().then(() =>
        fetch(`${api()}/wagering/transactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            providerId: 'provider-a',
            externalTransactionId: crypto.randomUUID(),
            playerId: players[index],
            walletId,
            roundId: `round-${index}`,
            gameId: 'game-1',
            kind: 'BET',
            money: { amount: '10.00', currency: 'BRL' },
          }),
        }),
      ),
    );

    await gate.allArrived;
    const start = performance.now();
    gate.release();
    const results = await Promise.all(requestPromises);
    const elapsedMs = performance.now() - start;

    for (const response of results) {
      expect(response.status).toBe(201);
    }
    expect(elapsedMs).toBeLessThan(5000);

    for (const walletId of wallets) {
      const reconciliation = await reconcile(walletId);
      expect(reconciliation.consistent).toBe(true);
    }
  }, 30_000);

  it('T-066 — processo morto após commit, antes do ack: reenvio da mesma mensagem não duplica o efeito', async () => {
    const playerId = crypto.randomUUID();
    const walletId = await openWallet(playerId, '100.00');
    const externalTransactionId = crypto.randomUUID();

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageGroupId: walletId,
        MessageDeduplicationId: externalTransactionId,
        MessageBody: JSON.stringify({
          idempotencyKey: `provider-a:${externalTransactionId}`,
          providerId: 'provider-a',
          externalTransactionId,
          playerId,
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '25.00', currency: 'BRL' },
        }),
      }),
    );

    const useCase = (app as INestApplication).get(ProcessWagerTransactionUseCase);
    const flakyClient = flakyDeleteSqsClient(sqsClient, 1);
    const consumer = new SqsWagerTransactionConsumer(
      flakyClient,
      queueUrl,
      dlqUrl,
      'wagering-consumer',
      useCase,
      { waitTimeSeconds: 2, visibilityTimeoutSeconds: 2 },
    );

    await consumer.receiveAndProcessBatch();

    const afterFirstAttempt = await fetch(`${api()}/wallets/${walletId}`);
    const afterFirstBody = (await afterFirstAttempt.json()) as { balance: { amount: string } };
    expect(afterFirstBody.balance.amount).toBe('75.00');

    const view = await fetch(
      `${api()}/providers/provider-a/wagering/transactions/${externalTransactionId}`,
    );
    const viewBody = (await view.json()) as { status: string };
    expect(viewBody.status).toBe('PROCESSED');

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    await consumer.receiveAndProcessBatch();

    const afterRedelivery = await fetch(`${api()}/wallets/${walletId}`);
    const afterRedeliveryBody = (await afterRedelivery.json()) as { balance: { amount: string } };
    expect(afterRedeliveryBody.balance.amount).toBe('75.00');

    const ledgerResponse = await fetch(`${api()}/wallets/${walletId}/ledger`);
    const ledgerBody = (await ledgerResponse.json()) as { entries: unknown[] };
    expect(ledgerBody.entries).toHaveLength(2);

    const finalPoll = await sqsClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    );
    expect(finalPoll.Messages ?? []).toHaveLength(0);

    const reconciliation = await reconcile(walletId);
    expect(reconciliation.consistent).toBe(true);
  }, 30_000);

  for (let iteration = 1; iteration <= 5; iteration += 1) {
    it(`T-067 — REFUND concorrente com o BET que referencia nunca perde a reversão (execução ${iteration}/5)`, async () => {
      const playerId = crypto.randomUUID();
      const walletId = await openWallet(playerId, '100.00');
      const betExternalId = crypto.randomUUID();

      const gate = startingGate(2);
      const betPromise = gate.arrive().then(() =>
        postWager({
          providerId: 'provider-a',
          externalTransactionId: betExternalId,
          playerId,
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '30.00', currency: 'BRL' },
        }),
      );
      const refundPromise = gate.arrive().then(() =>
        postWager({
          providerId: 'provider-a',
          externalTransactionId: crypto.randomUUID(),
          playerId,
          walletId,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'REFUND',
          money: { amount: '30.00', currency: 'BRL' },
          referenceExternalTransactionId: betExternalId,
        }),
      );

      await gate.allArrived;
      gate.release();
      const [betResponse, refundResponse] = await Promise.all([betPromise, refundPromise]);
      const betBody = (await betResponse.json()) as { status: string };
      const refundBody = (await refundResponse.json()) as { status: string; transactionId: string };

      expect(betBody.status).toBe('PROCESSED');
      expect(['PROCESSED', 'PENDING_REFERENCE']).toContain(refundBody.status);

      if (refundBody.status === 'PENDING_REFERENCE') {
        const worker = await buildPendingReferenceWorker();
        const processedCount = await worker.runOnce();
        expect(processedCount).toBe(1);
      }

      const finalRefund = await getWagerTransaction(refundBody.transactionId);
      expect(finalRefund.status).toBe('PROCESSED');

      const walletResponse = await fetch(`${api()}/wallets/${walletId}`);
      const walletBody = (await walletResponse.json()) as { balance: { amount: string } };
      expect(walletBody.balance.amount).toBe('100.00');

      const reconciliation = await reconcile(walletId);
      expect(reconciliation.consistent).toBe(true);
    }, 30_000);
  }

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    it(`T-068 — duas reversões concorrentes da mesma referência: exatamente uma processa (execução ${iteration}/3)`, async () => {
      const playerId = crypto.randomUUID();
      const walletId = await openWallet(playerId, '100.00');
      const betExternalId = crypto.randomUUID();

      const betResponse = await postWager({
        providerId: 'provider-a',
        externalTransactionId: betExternalId,
        playerId,
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '40.00', currency: 'BRL' },
      });
      expect(betResponse.status).toBe(201);

      const gate = startingGate(2);
      const refundPromises = Array.from({ length: 2 }, () =>
        gate.arrive().then(() =>
          postWager({
            providerId: 'provider-a',
            externalTransactionId: crypto.randomUUID(),
            playerId,
            walletId,
            roundId: 'round-1',
            gameId: 'game-1',
            kind: 'REFUND',
            money: { amount: '40.00', currency: 'BRL' },
            referenceExternalTransactionId: betExternalId,
          }),
        ),
      );

      await gate.allArrived;
      gate.release();
      const responses = await Promise.all(refundPromises);
      const bodies = await Promise.all(
        responses.map(
          (response) =>
            response.json() as Promise<{ status: string; failureCode?: string; error?: string }>,
        ),
      );

      const processed = bodies.filter((body) => body.status === 'PROCESSED');
      const rejected = bodies.filter((body) => body.status === 'REJECTED');
      expect(processed).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
      expect(rejected[0]?.error).toBe('ERR-018');

      const walletResponse = await fetch(`${api()}/wallets/${walletId}`);
      const walletBody = (await walletResponse.json()) as { balance: { amount: string } };
      expect(walletBody.balance.amount).toBe('100.00');

      const reconciliation = await reconcile(walletId);
      expect(reconciliation.consistent).toBe(true);
    }, 30_000);
  }
});
