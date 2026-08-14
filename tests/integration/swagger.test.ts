import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';
import { setupSwagger } from '@infrastructure/bootstrap/setup-swagger.ts';

const databaseUrl = 'postgres://wagering:wagering@localhost:55432/wagering_test';
import { describeIfDocker, runDockerCompose } from '@tests/support/docker-compose-harness.ts';

let app: INestApplication | undefined;
let baseUrl: string;

describeIfDocker('Swagger — documentação OpenAPI da API', () => {
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
    setupSwagger(app);
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

  it('GET /docs-json expõe um documento OpenAPI válido com as rotas de negócio', async () => {
    const response = await fetch(`${baseUrl}/docs-json`);
    expect(response.status).toBe(200);

    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/wallets',
        '/wallets/{walletId}',
        '/wallets/{walletId}/ledger',
        '/wallets/{walletId}/reconciliation',
        '/wagering/transactions',
        '/wagering/transactions/{transactionId}',
        '/providers/{providerId}/wagering/transactions/{externalTransactionId}',
        '/health/live',
        '/health/ready',
      ]),
    );
  });

  it('a rota /metrics não aparece na documentação interativa', async () => {
    const response = await fetch(`${baseUrl}/docs-json`);
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(document.paths['/metrics']).toBeUndefined();
  });

  it('GET /docs serve a UI interativa do Swagger', async () => {
    const response = await fetch(`${baseUrl}/docs`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });
});
