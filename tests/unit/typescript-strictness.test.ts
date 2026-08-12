import { beforeAll, describe, expect, it } from 'bun:test';

const projectRoot = Bun.fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const compiler = `${projectRoot}/node_modules/.bin/tsc`;

interface TypeCheckResult {
  readonly output: string;
  readonly exitCode: number;
}

async function typeCheck(project: string): Promise<TypeCheckResult> {
  if (!(await Bun.file(compiler).exists())) {
    throw new Error(`compilador ausente em ${compiler}; execute bun install antes da suite`);
  }

  const child = Bun.spawn([compiler, '--noEmit', '--pretty', 'false', '--project', project], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { output: `${stdout}${stderr}`, exitCode };
}

describe('configuração de TypeScript', () => {
  it('verifica o projeto inteiro sem nenhum erro de tipo', async () => {
    const result = await typeCheck('tsconfig.json');

    expect(result.output).toBe('');
    expect(result.exitCode).toBe(0);
  }, 120_000);
});

describe('rigor do verificador de tipos', () => {
  let violations: TypeCheckResult;

  beforeAll(async () => {
    violations = await typeCheck('tests/fixtures/strictness/tsconfig.json');
  }, 120_000);

  it('reprova o projeto de violações como um todo', () => {
    expect(violations.exitCode).not.toBe(0);
  });

  it('rejeita parâmetro com any implícito', () => {
    expect(violations.output).toMatch(/implicit-any\.ts.*error TS7006/);
  });

  it('rejeita acesso a índice de array tratado como sempre presente', () => {
    expect(violations.output).toMatch(/unchecked-index\.ts.*error TS2322/);
  });

  it('rejeita sobrescrita de método sem a palavra-chave override', () => {
    expect(violations.output).toMatch(/missing-override\.ts.*error TS4114/);
  });

  it('rejeita undefined atribuído a propriedade opcional', () => {
    expect(violations.output).toMatch(/exact-optional\.ts.*error TS2375/);
  });

  it('rejeita reexportação de tipo sem a palavra-chave type', () => {
    expect(violations.output).toMatch(/type-only-reexport\.ts.*error TS1205/);
  });
});
