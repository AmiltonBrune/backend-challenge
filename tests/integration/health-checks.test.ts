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

describeIfDocker('Health checks — contra Postgres e SQS reais', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] = databaseUrl;
    process.env['AWS_ENDPOINT_URL'] = 'http://localhost:54566';
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['AWS_ACCESS_KEY_ID'] = 'test';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
    await runDockerCompose(['up', '-d', '--wait', 'postgres-test', 'localstack-test']);

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

  it('GET /health/live retorna 200 status up no caminho normal', async () => {
    const response = await fetch(`${api()}/health/live`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('up');
  });

  it('GET /health/ready retorna 200 com database e queue up quando tudo está de pé', async () => {
    const response = await fetch(`${api()}/health/ready`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; checks: { database: string; queue: string } };
    expect(body.status).toBe('up');
    expect(body.checks.database).toBe('up');
    expect(body.checks.queue).toBe('up');
  });
});
