import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DataSource } from 'typeorm';

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

let AppDataSource: DataSource | undefined;

function dataSource(): DataSource {
  if (AppDataSource === undefined) {
    throw new Error('AppDataSource não inicializado — beforeAll falhou');
  }
  return AppDataSource;
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await dataSource().query(`SELECT to_regclass('public.${name}') AS exists_check`);
  return (rows as { exists_check: string | null }[])[0]?.exists_check !== null;
}

describeIfDocker('migration de inbox_messages e outbox_messages — contra Postgres real', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test']);
    ({ AppDataSource } = await import('@infrastructure/persistence/data-source.ts'));
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
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

  it('cria as tabelas inbox_messages e outbox_messages', async () => {
    expect(await tableExists('inbox_messages')).toBe(true);
    expect(await tableExists('outbox_messages')).toBe(true);
  });

  it('inbox: rejeita (consumer_name, message_id) duplicados', async () => {
    await dataSource().query(
      `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at)
       VALUES ('wager-consumer', 'msg-1', 'hash-1', now())`,
    );

    await expect(
      dataSource().query(
        `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at)
         VALUES ('wager-consumer', 'msg-1', 'hash-2', now())`,
      ),
    ).rejects.toThrow(/duplicate key|pk_inbox/);
  });

  it('inbox: o mesmo message_id para consumidores diferentes nao colide', async () => {
    await dataSource().query(
      `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at)
       VALUES ('consumer-a', 'msg-shared', 'hash', now())`,
    );

    await expect(
      dataSource().query(
        `INSERT INTO inbox_messages (consumer_name, message_id, payload_hash, received_at)
         VALUES ('consumer-b', 'msg-shared', 'hash', now())`,
      ),
    ).resolves.toBeDefined();
  });

  it('outbox: aceita insercao com next_attempt_at nulo e published_at nulo', async () => {
    await expect(
      dataSource().query(
        `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'WagerTransactionProcessed', '{}'::jsonb, now(), 0)`,
      ),
    ).resolves.toBeDefined();
  });

  it('outbox: cria o indice parcial de pendentes', async () => {
    const rows = await dataSource().query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'outbox_messages' AND indexname = 'ix_outbox_pending'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('outbox: mensagens sem next_attempt_at aparecem primeiro na ordenacao do indice', async () => {
    const aggregateId = crypto.randomUUID();

    await dataSource().query(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
       VALUES (gen_random_uuid(), $1, 'WalletBalanceChanged', '{}'::jsonb, now(), 1, now() + interval '5 minutes')`,
      [aggregateId],
    );
    await dataSource().query(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
       VALUES (gen_random_uuid(), $1, 'WalletBalanceChanged', '{}'::jsonb, now(), 0, NULL)`,
      [aggregateId],
    );

    const rows = await dataSource().query(
      `SELECT next_attempt_at FROM outbox_messages
       WHERE aggregate_id = $1 AND published_at IS NULL
       ORDER BY next_attempt_at NULLS FIRST, occurred_at
       LIMIT 1`,
      [aggregateId],
    );

    expect((rows as { next_attempt_at: Date | null }[])[0]?.next_attempt_at).toBeNull();
  });

  it('reverte removendo as duas tabelas', async () => {
    while ((await tableExists('inbox_messages')) || (await tableExists('outbox_messages'))) {
      await dataSource().undoLastMigration();
    }

    expect(await tableExists('inbox_messages')).toBe(false);
    expect(await tableExists('outbox_messages')).toBe(false);

    await dataSource().runMigrations();
  });
});
