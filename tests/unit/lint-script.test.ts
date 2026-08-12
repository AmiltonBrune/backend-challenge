import { describe, expect, it } from 'bun:test';

const projectRoot = Bun.fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const eslintBin = `${projectRoot}/node_modules/.bin/eslint`;

describe('script de lint', () => {
  it('executa o eslint sobre o repositório sem erro de configuração', async () => {
    if (!(await Bun.file(eslintBin).exists())) {
      throw new Error(`eslint ausente em ${eslintBin}; execute bun install antes da suite`);
    }

    const child = Bun.spawn([eslintBin, '.'], {
      cwd: projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(stderr).not.toContain('requires type information');
    expect(stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(stdout + stderr).not.toContain('Oops! Something went wrong');
    expect(exitCode).toBe(0);
  }, 60_000);
});
