import type { DatabaseHealthPort, HealthCheckStatus } from '@application/ports/database-health-port.ts';
import type { QueueHealthPort } from '@application/ports/queue-health-port.ts';

export interface ReadinessChecks {
  readonly database: HealthCheckStatus;
  readonly queue: HealthCheckStatus;
}

export interface ReadinessResult {
  readonly status: 'up' | 'error';
  readonly checks: ReadinessChecks;
}

export class CheckReadinessUseCase {
  constructor(
    private readonly databaseHealth: DatabaseHealthPort,
    private readonly queueHealth: QueueHealthPort,
  ) {}

  async execute(): Promise<ReadinessResult> {
    const [database, queue] = await Promise.all([
      this.databaseHealth.check(),
      this.queueHealth.check(),
    ]);

    const status = database === 'up' && queue === 'up' ? 'up' : 'error';

    return { status, checks: { database, queue } };
  }
}
