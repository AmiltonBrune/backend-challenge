import { describe, expect, it } from 'bun:test';
import packageJson from '../../package.json';

const requiredScripts = [
  'dev',
  'test',
  'test:integration',
  'test:concurrency',
  'test:load',
  'migration:generate',
  'migration:run',
  'migration:revert',
  'lint',
  'typecheck',
] as const;

describe('scripts do package.json', () => {
  for (const script of requiredScripts) {
    it(`declara o script ${script}`, () => {
      const scripts = packageJson.scripts as Record<string, string | undefined>;
      expect(scripts[script]).toBeDefined();
      expect(scripts[script]).not.toBe('');
    });
  }

  it('test:load invoca o binario do k6, nao o bun', () => {
    const scripts = packageJson.scripts as Record<string, string | undefined>;
    expect(scripts['test:load']).toContain('k6');
    expect(scripts['test:load']).not.toContain('bun run');
  });

  it('test padrao roda apenas a suite unitaria', () => {
    const scripts = packageJson.scripts as Record<string, string | undefined>;
    expect(scripts['test']).toContain('tests/unit');
  });
});
