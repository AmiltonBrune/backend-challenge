import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options.ts';

function requireDatabaseUrl(): string {
  const value = process.env['DATABASE_URL'];
  if (value === undefined || value === '') {
    throw new Error('DATABASE_URL ausente: necessária para conectar ao PostgreSQL.');
  }
  return value;
}

export const AppDataSource = new DataSource(buildDataSourceOptions(requireDatabaseUrl()));
