import '@infrastructure/observability/tracing-bootstrap.ts';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { resolveAppRole } from '@infrastructure/bootstrap/app-role.ts';
import { selectRoleModule } from '@infrastructure/bootstrap/select-role-module.ts';
import { setupSwagger } from '@infrastructure/bootstrap/setup-swagger.ts';
import { loadConfig } from '@infrastructure/config/load-config.ts';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';
import { AuthGuard } from '@interface/http/guards/auth.guard.ts';
import { LivenessState } from '@application/health/liveness-state.ts';
import { buildSqsClient } from '@infrastructure/messaging/sqs-client-factory.ts';
import { ensureWagerQueues } from '@infrastructure/messaging/ensure-wager-queues.ts';
import { logger } from '@infrastructure/observability/logger.ts';
import { startMetricsHttpServer } from '@infrastructure/observability/metrics-http-server.ts';
import { bootstrapConsumer } from '@workers/consumer/bootstrap-consumer.ts';
import { bootstrapPendingReferenceRetryWorker } from '@workers/pending-reference/bootstrap-pending-reference-worker.ts';
import { bootstrapOutboxPublisher } from '@workers/outbox-publisher/bootstrap-outbox-publisher.ts';

async function bootstrap(): Promise<void> {
  const role = resolveAppRole(process.env['APP_ROLE']);
  const config = loadConfig(process.env, role);
  const module = selectRoleModule(role);

  if (role === 'api') {
    const app = await NestFactory.create(module);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    app.useGlobalGuards(new AuthGuard());
    setupSwagger(app);

    const livenessState = app.get(LivenessState);
    process.on('SIGTERM', () => {
      livenessState.markUnhealthy();
      app.close().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('falha ao encerrar a aplicação', { reason: message });
      });
    });

    await app.listen(config.port);
    return;
  }

  if (role === 'consumer' || role === 'worker') {
    await ensureWagerQueues(buildSqsClient(config));
  }

  if (role === 'consumer') {
    const { consumer, metrics } = await bootstrapConsumer(config);
    const metricsServer = startMetricsHttpServer(config.metricsPort, metrics);
    consumer.start();
    process.on('SIGTERM', () => {
      metricsServer.close().catch(() => undefined);
      consumer.stop().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('falha ao encerrar o consumer', { reason: message });
      });
    });
    return;
  }

  if (role === 'worker') {
    if (config.worker === undefined) {
      throw new Error('Configuração do worker ausente.');
    }

    const { worker: outboxPublisher, metrics } = await bootstrapOutboxPublisher(config);
    const metricsServer = startMetricsHttpServer(config.metricsPort, metrics);
    outboxPublisher.start();

    const pendingReferenceWorker = await bootstrapPendingReferenceRetryWorker(config);
    pendingReferenceWorker.start(config.worker.pendingReferencePollIntervalMs);

    process.on('SIGTERM', () => {
      pendingReferenceWorker.stop();
      metricsServer.close().catch(() => undefined);
      outboxPublisher.stop().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`falha ao encerrar o outbox publisher: ${message}`);
      });
    });
    return;
  }

  await NestFactory.createApplicationContext(module);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('falha no bootstrap', { reason: message });
  process.exit(1);
});
