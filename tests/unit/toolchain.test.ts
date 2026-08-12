import { describe, expect, it } from 'bun:test';

const fixture = Bun.fileURLToPath(new URL('../fixtures/typed-entrypoint.ts', import.meta.url));

describe('cadeia de ferramentas', () => {
  it('executa um arquivo TypeScript diretamente, sem etapa de build', async () => {
    const child = Bun.spawn(['bun', 'run', fixture], { stdout: 'pipe', stderr: 'pipe' });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('wagering-processor:ready');
  });
});
