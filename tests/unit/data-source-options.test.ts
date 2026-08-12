import { describe, expect, it } from 'bun:test';
import { buildDataSourceOptions } from '@infrastructure/persistence/data-source-options.ts';

const url = 'postgres://wagering:wagering@localhost:5432/wagering';

describe('buildDataSourceOptions', () => {
  it('nunca habilita synchronize', () => {
    const options = buildDataSourceOptions(url);

    expect(options.synchronize).toBe(false);
  });

  it('usa o driver postgres', () => {
    const options = buildDataSourceOptions(url);

    expect(options.type).toBe('postgres');
  });

  it('usa a url recebida, sem hardcode', () => {
    const options = buildDataSourceOptions(url);

    if (options.type !== 'postgres') {
      throw new Error('esperava driver postgres');
    }
    expect(options.url).toBe(url);
  });

  it('aponta migrations para a pasta de migrations do projeto', () => {
    const options = buildDataSourceOptions(url);
    const migrations = options.migrations;

    if (!Array.isArray(migrations)) {
      throw new Error('esperava migrations como array');
    }
    expect(migrations.length).toBeGreaterThan(0);
    expect(String(migrations[0])).toContain('persistence/migrations');
  });

  it('nao declara entidades ainda', () => {
    const options = buildDataSourceOptions(url);

    expect(options.entities).toEqual([]);
  });
});
