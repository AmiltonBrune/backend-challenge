import { describe, expect, it } from 'bun:test';

const projectRoot = Bun.fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const eslintBin = `${projectRoot}/node_modules/.bin/eslint`;
const fixturesDir = `${projectRoot}/tests/fixtures/boundaries`;

interface LintMessage {
  readonly ruleId: string | null;
}

interface LintFileResult {
  readonly errorCount: number;
  readonly messages: readonly LintMessage[];
}

async function lint(relativeFile: string): Promise<LintFileResult> {
  if (!(await Bun.file(eslintBin).exists())) {
    throw new Error(`eslint ausente em ${eslintBin}; execute bun install antes da suite`);
  }

  const child = Bun.spawn(
    [eslintBin, '--no-color', '--format', 'json', relativeFile],
    { cwd: fixturesDir, stdout: 'pipe', stderr: 'pipe' },
  );

  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);

  const jsonLine = stdout.split('\n').find((line) => line.startsWith('[{') || line === '[]');
  if (jsonLine === undefined) {
    throw new Error(`saida do eslint sem linha json reconhecivel para ${relativeFile}: ${stdout}`);
  }

  const [result] = JSON.parse(jsonLine) as [LintFileResult?];
  if (result === undefined) {
    throw new Error(`eslint nao retornou resultado para ${relativeFile}, exit code ${exitCode}`);
  }

  return result;
}

function ruleIds(result: LintFileResult): readonly (string | null)[] {
  return result.messages.map((message) => message.ruleId);
}

describe('boundaries entre camadas — proibições', () => {
  it('proíbe o domínio de importar typeorm', async () => {
    const result = await lint('src/domain/imports-typeorm.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar @nestjs/common', async () => {
    const result = await lint('src/domain/imports-nestjs.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar infrastructure', async () => {
    const result = await lint('src/domain/imports-infrastructure.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar interface', async () => {
    const result = await lint('src/domain/imports-interface.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar infrastructure mesmo via alias de caminho', async () => {
    const result = await lint('src/domain/imports-infrastructure-via-alias.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('proíbe interface de importar infrastructure diretamente', async () => {
    const result = await lint('src/interface/imports-infrastructure.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('proíbe application de importar workers', async () => {
    const result = await lint('src/application/imports-workers.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/dependencies');
  });

  it('reporta arquivo fora de qualquer camada conhecida', async () => {
    const result = await lint('src/unknown/stray-file.ts');

    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain('boundaries/no-unknown-files');
  });
});

describe('boundaries entre camadas — permissões', () => {
  it('permite application importar domain', async () => {
    const result = await lint('src/application/imports-domain.ts');

    expect(result.errorCount).toBe(0);
  });

  it('permite application importar domain via alias de caminho', async () => {
    const result = await lint('src/application/imports-domain-via-alias.ts');

    expect(result.errorCount).toBe(0);
  });

  it('permite infrastructure importar domain e application', async () => {
    const result = await lint('src/infrastructure/imports-domain-and-application.ts');

    expect(result.errorCount).toBe(0);
  });

  it('permite workers importar domain, application e infrastructure', async () => {
    const result = await lint('src/workers/imports-infrastructure.ts');

    expect(result.errorCount).toBe(0);
  });
});
