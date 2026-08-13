import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { resolveAppRole } from '@infrastructure/bootstrap/app-role.ts';
import { selectRoleModule } from '@infrastructure/bootstrap/select-role-module.ts';
import { loadConfig } from '@infrastructure/config/load-config.ts';
import { DomainExceptionFilter } from '@interface/http/exceptions/domain-exception-filter.ts';
import { LivenessState } from '@application/health/liveness-state.ts';

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

    const livenessState = app.get(LivenessState);
    process.on('SIGTERM', () => {
      livenessState.markUnhealthy();
      app.close().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`falha ao encerrar a aplicação: ${message}`);
      });
    });

    await app.listen(config.port);
    return;
  }

  await NestFactory.createApplicationContext(module);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`falha no bootstrap: ${message}`);
  process.exit(1);
});
