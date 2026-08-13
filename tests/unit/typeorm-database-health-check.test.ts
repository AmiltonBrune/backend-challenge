import { describe, expect, it } from 'bun:test';
import { DataSource } from 'typeorm';
import { TypeOrmDatabaseHealthCheck } from '@infrastructure/health/typeorm-database-health-check.ts';

describe('TypeOrmDatabaseHealthCheck', () => {
  it('retorna down quando o DataSource não está inicializado', async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      url: 'postgres://invalid:invalid@127.0.0.1:1/invalid',
    });
    const check = new TypeOrmDatabaseHealthCheck(dataSource, 200);

    expect(await check.check()).toBe('down');
  });
});
