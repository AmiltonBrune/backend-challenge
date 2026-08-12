import { fileURLToPath } from 'node:url';
import type { DataSourceOptions } from 'typeorm';

const migrationsDir = fileURLToPath(new URL('./migrations/*.ts', import.meta.url));

export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    entities: [],
    migrations: [migrationsDir],
  };
}
