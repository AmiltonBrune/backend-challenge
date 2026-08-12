import { describe, expect, it } from 'bun:test';

const fixture = new URL('../fixtures/typed-entrypoint.ts', import.meta.url).pathname;

describe('cadeia de ferramentas', () => {
  it('executa um arquivo TypeScript diretamente, sem etapa de build', async () => {
    const child = Bun.spawn(['bun', 'run', fixture], { stdout: 'pipe', stderr: 'pipe' });

    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('wagering-processor:ready');
  });
});
