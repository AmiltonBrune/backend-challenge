import { describe, expect, it } from 'bun:test';

const projectRoot = Bun.fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const eslintBin = `${projectRoot}/node_modules/.bin/eslint`;
const fixturesDir = `${projectRoot}/tests/fixtures/boundaries`;

interface LintResult {
  readonly output: string;
  readonly exitCode: number;
}

async function lint(relativeFile: string): Promise<LintResult> {
  if (!(await Bun.file(eslintBin).exists())) {
    throw new Error(`eslint ausente em ${eslintBin}; execute bun install antes da suite`);
  }

  const child = Bun.spawn(
    [eslintBin, '--no-color', '--format', 'json', relativeFile],
    { cwd: fixturesDir, stdout: 'pipe', stderr: 'pipe' },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { output: `${stdout}${stderr}`, exitCode };
}

describe('boundaries entre camadas', () => {
  it('proíbe o domínio de importar typeorm', async () => {
    const result = await lint('src/domain/imports-typeorm.ts');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar @nestjs/common', async () => {
    const result = await lint('src/domain/imports-nestjs.ts');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar infrastructure', async () => {
    const result = await lint('src/domain/imports-infrastructure.ts');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('proíbe o domínio de importar interface', async () => {
    const result = await lint('src/domain/imports-interface.ts');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('proíbe interface de importar infrastructure diretamente', async () => {
    const result = await lint('src/interface/imports-infrastructure.ts');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('boundaries/dependencies');
  });

  it('permite application importar domain', async () => {
    const result = await lint('src/application/imports-domain.ts');

    expect(result.exitCode).toBe(0);
  });

  it('permite infrastructure importar domain e application', async () => {
    const result = await lint('src/infrastructure/imports-domain-and-application.ts');

    expect(result.exitCode).toBe(0);
  });
});
