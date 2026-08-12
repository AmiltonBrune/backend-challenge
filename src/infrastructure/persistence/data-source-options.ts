import { fileURLToPath } from 'node:url';
import type { DataSourceOptions } from 'typeorm';

const migrationsDir = fileURLToPath(new URL('./migrations/*.ts', import.meta.url));

export interface DataSourceOptionsParams {
  readonly databaseUrl: string;
  readonly poolSize: number;
  readonly statementTimeoutMs: number;
}

export function buildDataSourceOptions(params: DataSourceOptionsParams): DataSourceOptions {
  return {
    type: 'postgres',
    url: params.databaseUrl,
    synchronize: false,
    entities: [],
    migrations: [migrationsDir],
    extra: {
      max: params.poolSize,
      statement_timeout: params.statementTimeoutMs,
    },
  };
}
