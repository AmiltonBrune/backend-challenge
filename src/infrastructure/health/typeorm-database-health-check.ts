import type { DataSource } from 'typeorm';
import type { DatabaseHealthPort, HealthCheckStatus } from '@application/ports/database-health-port.ts';

const DEFAULT_TIMEOUT_MS = 2000;

export class TypeOrmDatabaseHealthCheck implements DatabaseHealthPort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async check(): Promise<HealthCheckStatus> {
    if (!this.dataSource.isInitialized) {
      return 'down';
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout na verificação do banco')), this.timeoutMs);
      });
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
