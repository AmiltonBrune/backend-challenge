import { describe, expect, it } from 'bun:test';
import { buildDataSourceOptions } from '@infrastructure/persistence/data-source-options.ts';

const baseParams = {
  databaseUrl: 'postgres://wagering:wagering@localhost:5432/wagering',
  poolSize: 10,
  statementTimeoutMs: 5000,
};

describe('buildDataSourceOptions', () => {
  it('nunca habilita synchronize', () => {
    const options = buildDataSourceOptions(baseParams);

    expect(options.synchronize).toBe(false);
  });

  it('usa o driver postgres', () => {
    const options = buildDataSourceOptions(baseParams);

    expect(options.type).toBe('postgres');
  });

  it('usa a url recebida, sem hardcode', () => {
    const options = buildDataSourceOptions(baseParams);

    if (options.type !== 'postgres') {
      throw new Error('esperava driver postgres');
    }
    expect(options.url).toBe(baseParams.databaseUrl);
  });

  it('aplica o tamanho de pool recebido', () => {
    const options = buildDataSourceOptions({ ...baseParams, poolSize: 25 });

    if (options.type !== 'postgres') {
      throw new Error('esperava driver postgres');
    }
    expect(options.extra?.max).toBe(25);
  });

  it('aplica o statement timeout recebido', () => {
    const options = buildDataSourceOptions({ ...baseParams, statementTimeoutMs: 8000 });

    if (options.type !== 'postgres') {
      throw new Error('esperava driver postgres');
    }
    expect(options.extra?.statement_timeout).toBe(8000);
  });

  it('aponta migrations para a pasta de migrations do projeto', () => {
    const options = buildDataSourceOptions(baseParams);
    const migrations = options.migrations;

    if (!Array.isArray(migrations)) {
      throw new Error('esperava migrations como array');
    }
    expect(migrations.length).toBeGreaterThan(0);
    expect(String(migrations[0])).toContain('persistence/migrations');
  });

  it('declara as cinco entidades do schema', () => {
    const options = buildDataSourceOptions(baseParams);
    const entities = options.entities;

    if (!Array.isArray(entities)) {
      throw new Error('esperava entities como array');
    }
    expect(entities).toHaveLength(5);
  });
});
