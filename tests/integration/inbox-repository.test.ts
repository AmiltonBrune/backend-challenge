import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { InboxRepository } from '@application/ports/inbox-repository.ts';
import type { UnitOfWork } from '@application/ports/unit-of-work.ts';
import { InboxMessage } from '@domain/messaging/inbox-message.ts';

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

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-01-01T00:00:00.000Z');
  }
}

let AppDataSource: DataSource | undefined;
let unitOfWork: UnitOfWork | undefined;
let repository: InboxRepository | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

function uow(): UnitOfWork {
  if (unitOfWork === undefined) {
    throw new Error('UnitOfWork não inicializado — beforeAll falhou');
  }
  return unitOfWork;
}

function repo(): InboxRepository {
  if (repository === undefined) {
    throw new Error('InboxRepository não inicializado — beforeAll falhou');
  }
  return repository;
}

describeIfDocker('TypeOrmInboxRepository — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    const { TypeOrmUnitOfWork } = await import(
      '@infrastructure/persistence/repositories/typeorm-unit-of-work.ts'
    );
    const { TypeOrmInboxRepository } = await import(
      '@infrastructure/persistence/repositories/typeorm-inbox-repository.ts'
    );
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    unitOfWork = new TypeOrmUnitOfWork(AppDataSource);
    repository = new TypeOrmInboxRepository(new FixedClock());
  }, 60_000);

  afterAll(async () => {
    try {
      if (AppDataSource?.isInitialized === true) {
        await AppDataSource.destroy();
      }
    } finally {
      await runDockerCompose(['down', '-v']);
    }
  }, 30_000);

  it('insere uma mensagem nova e retorna inserted', async () => {
    const messageId = crypto.randomUUID();
    const message = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-a',
      payloadHash: 'hash-1',
    });

    const result = await uow().run((ctx) => repo().insert(ctx, message));
    expect(result).toBe('inserted');

    const rows = await dataSource().query(
      `SELECT payload_hash, processed_at FROM inbox_messages
       WHERE consumer_name = $1 AND message_id = $2`,
      ['consumer-a', messageId],
    );
    expect(rows).toHaveLength(1);
    expect((rows as { payload_hash: string }[])[0]!.payload_hash).toBe('hash-1');
    expect((rows as { processed_at: Date | null }[])[0]!.processed_at).toBeNull();
  });

  it('retorna already-processed e não sobrescreve ao reinserir a mesma (consumerName, messageId)', async () => {
    const messageId = crypto.randomUUID();
    const first = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-b',
      payloadHash: 'hash-original',
    });
    const replay = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-b',
      payloadHash: 'hash-diferente-no-reenvio',
    });

    const firstResult = await uow().run((ctx) => repo().insert(ctx, first));
    expect(firstResult).toBe('inserted');

    const replayResult = await uow().run((ctx) => repo().insert(ctx, replay));
    expect(replayResult).toBe('already-processed');

    const rows = await dataSource().query(
      `SELECT payload_hash FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2`,
      ['consumer-b', messageId],
    );
    expect(rows).toHaveLength(1);
    expect((rows as { payload_hash: string }[])[0]!.payload_hash).toBe('hash-original');
  });

  it('permite o mesmo messageId para consumidores diferentes', async () => {
    const messageId = crypto.randomUUID();
    const forConsumerC = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-c',
      payloadHash: 'hash-c',
    });
    const forConsumerD = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-d',
      payloadHash: 'hash-d',
    });

    const resultC = await uow().run((ctx) => repo().insert(ctx, forConsumerC));
    const resultD = await uow().run((ctx) => repo().insert(ctx, forConsumerD));

    expect(resultC).toBe('inserted');
    expect(resultD).toBe('inserted');
  });

  it('mantém a transação utilizável após um insert duplicado, sem abortar o restante da unidade de trabalho', async () => {
    const messageId = crypto.randomUUID();
    const first = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-e',
      payloadHash: 'hash-e',
    });
    const replay = InboxMessage.receive({
      messageId,
      consumerName: 'consumer-e',
      payloadHash: 'hash-e',
    });

    await uow().run((ctx) => repo().insert(ctx, first));

    const outcome = await uow().run(async (ctx) => {
      const result = await repo().insert(ctx, replay);
      const manager = ctx as import('typeorm').EntityManager;
      const rows = await manager.query('SELECT 1 AS ok');
      return { result, probe: (rows as { ok: number }[])[0]?.ok };
    });

    expect(outcome.result).toBe('already-processed');
    expect(outcome.probe).toBe(1);
  });
});
