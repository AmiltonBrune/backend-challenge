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

describeIfDocker('migration de wallets — contra Postgres real', () => {
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

  function dataSource(): DataSource {
    if (AppDataSource === undefined) {
      throw new Error('AppDataSource não inicializado — beforeAll falhou');
    }
    return AppDataSource;
  }

  it('cria a tabela wallets', async () => {
    const rows = await dataSource().query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets' ORDER BY column_name`,
    );
    const columns = (rows as { column_name: string }[]).map((r) => r.column_name);

    expect(columns).toEqual([
      'balance_amount',
      'created_at',
      'currency',
      'id',
      'player_id',
      'updated_at',
      'version',
    ]);
  });

  it('rejeita saldo negativo via CHECK', async () => {
    await expect(
      dataSource().query(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', -10.00, 1, now(), now())`,
      ),
    ).rejects.toThrow(/ck_wallet_balance_non_negative|violates check constraint/);
  });

  it('rejeita NaN como saldo — numeric aceita NaN e o define maior que qualquer valor', async () => {
    await expect(
      dataSource().query(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 'NaN', 1, now(), now())`,
      ),
    ).rejects.toThrow(/ck_wallet_balance_non_negative|violates check constraint/);
  });

  it('rejeita version menor que 1 via CHECK', async () => {
    await expect(
      dataSource().query(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'BRL', 0.00, 0, now(), now())`,
      ),
    ).rejects.toThrow(/ck_wallet_version_positive|violates check constraint/);
  });

  it('rejeita duas wallets para o mesmo player e moeda', async () => {
    const playerId: string = (await dataSource().query('SELECT gen_random_uuid() AS id'))[0].id;

    await dataSource().query(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'BRL', 100.00, 1, now(), now())`,
      [playerId],
    );

    await expect(
      dataSource().query(
        `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'BRL', 50.00, 1, now(), now())`,
        [playerId],
      ),
    ).rejects.toThrow(/uq_wallet_player_currency|duplicate key/);
  });

  it('reverte removendo a tabela', async () => {
    async function walletsExists(): Promise<boolean> {
      const rows = await dataSource().query(`SELECT to_regclass('public.wallets') AS exists_check`);
      return (rows as { exists_check: string | null }[])[0]?.exists_check !== null;
    }

    while (await walletsExists()) {
      await dataSource().undoLastMigration();
    }

    expect(await walletsExists()).toBe(false);

    await dataSource().runMigrations();
  });
});
