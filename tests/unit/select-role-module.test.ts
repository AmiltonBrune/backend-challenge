import { describe, expect, it } from 'bun:test';
import { selectRoleModule } from '@infrastructure/bootstrap/select-role-module.ts';
import { ApiModule } from '@infrastructure/bootstrap/roles/api.module.ts';
import { ConsumerModule } from '@infrastructure/bootstrap/roles/consumer.module.ts';
import { WorkerModule } from '@infrastructure/bootstrap/roles/worker.module.ts';

describe('selectRoleModule', () => {
  it('seleciona ApiModule para api', () => {
    expect(selectRoleModule('api')).toBe(ApiModule);
  });

  it('seleciona ConsumerModule para consumer', () => {
    expect(selectRoleModule('consumer')).toBe(ConsumerModule);
  });

  it('seleciona WorkerModule para worker', () => {
    expect(selectRoleModule('worker')).toBe(WorkerModule);
  });
});
