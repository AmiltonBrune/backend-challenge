import type { Type } from '@nestjs/common';
import type { AppRole } from './app-role.ts';
import { ApiModule } from './roles/api.module.ts';
import { ConsumerModule } from './roles/consumer.module.ts';
import { WorkerModule } from './roles/worker.module.ts';

const moduleByRole: Record<AppRole, Type<unknown>> = {
  api: ApiModule,
  consumer: ConsumerModule,
  worker: WorkerModule,
};

export function selectRoleModule(role: AppRole): Type<unknown> {
  return moduleByRole[role];
}
