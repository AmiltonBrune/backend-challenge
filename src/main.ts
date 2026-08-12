import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { resolveAppRole } from '@infrastructure/bootstrap/app-role.ts';
import { selectRoleModule } from '@infrastructure/bootstrap/select-role-module.ts';

async function bootstrap(): Promise<void> {
  const role = resolveAppRole(process.env['APP_ROLE']);
  const module = selectRoleModule(role);

  if (role === 'api') {
    const app = await NestFactory.create(module);
    const port = Number(process.env['PORT'] ?? 3000);
    await app.listen(port);
    return;
  }

  await NestFactory.createApplicationContext(module);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`falha no bootstrap: ${message}`);
  process.exit(1);
});
