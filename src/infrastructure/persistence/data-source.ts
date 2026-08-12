import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options.ts';

function requireDatabaseUrl(): string {
  const value = process.env['DATABASE_URL'];
  if (value === undefined || value === '') {
    throw new Error('DATABASE_URL ausente: necessária para conectar ao PostgreSQL.');
  }
  return value;
}

function readOptionalInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} com valor numérico inválido: "${value}".`);
  }
  return parsed;
}

export const AppDataSource = new DataSource(
  buildDataSourceOptions({
    databaseUrl: requireDatabaseUrl(),
    poolSize: readOptionalInt('DB_POOL_SIZE', 10),
    statementTimeoutMs: readOptionalInt('DB_STATEMENT_TIMEOUT_MS', 5000),
  }),
);
