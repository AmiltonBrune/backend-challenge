import type { HealthCheckStatus } from './database-health-port.ts';

export interface QueueHealthPort {
  check(): Promise<HealthCheckStatus>;
}
