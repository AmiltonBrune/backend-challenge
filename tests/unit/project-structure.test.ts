import { describe, expect, it } from 'bun:test';

const projectRoot = Bun.fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

const expectedDirs = [
  'src/domain/money',
  'src/domain/wallet',
  'src/domain/wager-transaction',
  'src/domain/ledger',
  'src/domain/messaging',
  'src/domain/events',
  'src/domain/errors',
  'src/application/use-cases',
  'src/application/ports',
  'src/application/dto',
  'src/infrastructure/persistence/entities',
  'src/infrastructure/persistence/mappers',
  'src/infrastructure/persistence/repositories',
  'src/infrastructure/persistence/migrations',
  'src/infrastructure/messaging',
  'src/infrastructure/observability',
  'src/infrastructure/config',
  'src/infrastructure/bootstrap',
  'src/interface/http',
  'src/workers',
];

describe('árvore de pastas', () => {
  for (const dir of expectedDirs) {
    it(`${dir} existe e contém pelo menos um arquivo .ts`, async () => {
      const glob = new Bun.Glob('*.ts');
      const files = [...glob.scanSync({ cwd: `${projectRoot}/${dir}` })];

      expect(files.length).toBeGreaterThan(0);
    });
  }
});
