import { describe, expect, it } from 'bun:test';
import { LivenessState } from '@application/health/liveness-state.ts';
import { CheckReadinessUseCase } from '@application/use-cases/check-readiness-use-case.ts';
import type { DatabaseHealthPort, HealthCheckStatus } from '@application/ports/database-health-port.ts';
import type { QueueHealthPort } from '@application/ports/queue-health-port.ts';
import { HealthController } from '@interface/http/controllers/health.controller.ts';

class FixedHealthCheck implements DatabaseHealthPort, QueueHealthPort {
  constructor(private readonly result: HealthCheckStatus) {}

  async check(): Promise<HealthCheckStatus> {
    return this.result;
  }
}

interface FakeResponse {
  statusCode: number | undefined;
  status(code: number): this;
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: undefined,
    status(code) {
      response.statusCode = code;
      return response;
    },
  };
  return response;
}

describe('HealthController', () => {
  it('GET /health/live retorna 200 status up quando saudável', () => {
    const controller = new HealthController(
      new LivenessState(),
      new CheckReadinessUseCase(new FixedHealthCheck('up'), new FixedHealthCheck('up')),
    );
    const response = fakeResponse();

    const body = controller.live(response as never);

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: 'up' });
  });

  it('GET /health/live retorna 503 status error quando não-saudável', () => {
    const livenessState = new LivenessState();
    livenessState.markUnhealthy();
    const controller = new HealthController(
      livenessState,
      new CheckReadinessUseCase(new FixedHealthCheck('up'), new FixedHealthCheck('up')),
    );
    const response = fakeResponse();

    const body = controller.live(response as never);

    expect(response.statusCode).toBe(503);
    expect(body).toEqual({ status: 'error' });
  });

  it('GET /health/ready retorna 200 quando database e queue estão up', async () => {
    const controller = new HealthController(
      new LivenessState(),
      new CheckReadinessUseCase(new FixedHealthCheck('up'), new FixedHealthCheck('up')),
    );
    const response = fakeResponse();

    const body = await controller.ready(response as never);

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ status: 'up', checks: { database: 'up', queue: 'up' } });
  });

  it('GET /health/ready retorna 503 quando o database está down', async () => {
    const controller = new HealthController(
      new LivenessState(),
      new CheckReadinessUseCase(new FixedHealthCheck('down'), new FixedHealthCheck('up')),
    );
    const response = fakeResponse();

    const body = await controller.ready(response as never);

    expect(response.statusCode).toBe(503);
    expect(body).toEqual({ status: 'error', checks: { database: 'down', queue: 'up' } });
  });

  it('GET /health/ready retorna 503 quando a queue está down', async () => {
    const controller = new HealthController(
      new LivenessState(),
      new CheckReadinessUseCase(new FixedHealthCheck('up'), new FixedHealthCheck('down')),
    );
    const response = fakeResponse();

    const body = await controller.ready(response as never);

    expect(response.statusCode).toBe(503);
    expect(body).toEqual({ status: 'error', checks: { database: 'up', queue: 'down' } });
  });
});
