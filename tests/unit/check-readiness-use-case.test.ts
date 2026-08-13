import { describe, expect, it } from 'bun:test';
import type { DatabaseHealthPort, HealthCheckStatus } from '@application/ports/database-health-port.ts';
import type { QueueHealthPort } from '@application/ports/queue-health-port.ts';
import { CheckReadinessUseCase } from '@application/use-cases/check-readiness-use-case.ts';

class FixedHealthCheck implements DatabaseHealthPort, QueueHealthPort {
  constructor(private readonly result: HealthCheckStatus) {}

  async check(): Promise<HealthCheckStatus> {
    return this.result;
  }
}

describe('CheckReadinessUseCase', () => {
  it('retorna status up com database e queue up quando ambos estão saudáveis', async () => {
    const useCase = new CheckReadinessUseCase(
      new FixedHealthCheck('up'),
      new FixedHealthCheck('up'),
    );

    const result = await useCase.execute();

    expect(result).toEqual({ status: 'up', checks: { database: 'up', queue: 'up' } });
  });

  it('retorna status error quando o database está down', async () => {
    const useCase = new CheckReadinessUseCase(
      new FixedHealthCheck('down'),
      new FixedHealthCheck('up'),
    );

    const result = await useCase.execute();

    expect(result).toEqual({ status: 'error', checks: { database: 'down', queue: 'up' } });
  });

  it('retorna status error quando a queue está down', async () => {
    const useCase = new CheckReadinessUseCase(
      new FixedHealthCheck('up'),
      new FixedHealthCheck('down'),
    );

    const result = await useCase.execute();

    expect(result).toEqual({ status: 'error', checks: { database: 'up', queue: 'down' } });
  });

  it('retorna status error quando ambos estão down', async () => {
    const useCase = new CheckReadinessUseCase(
      new FixedHealthCheck('down'),
      new FixedHealthCheck('down'),
    );

    const result = await useCase.execute();

    expect(result).toEqual({ status: 'error', checks: { database: 'down', queue: 'down' } });
  });
});
