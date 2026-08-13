export type HealthCheckStatus = 'up' | 'down';

export interface DatabaseHealthPort {
  check(): Promise<HealthCheckStatus>;
}
