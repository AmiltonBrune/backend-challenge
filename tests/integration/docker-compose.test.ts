import { describe, expect, it } from 'bun:test';

const projectRoot = Bun.fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

async function run(command: readonly string[]): Promise<{ stdout: string; exitCode: number }> {
  const child = Bun.spawn([...command], { cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { stdout, exitCode };
}

describe('docker compose', () => {
  it('a configuração raiz é válida', async () => {
    const result = await run(['docker', 'compose', 'config', '--quiet']);
    expect(result.exitCode).toBe(0);
  });

  it('a configuração do profile de teste é válida', async () => {
    const result = await run(['docker', 'compose', '--profile', 'test', 'config', '--quiet']);
    expect(result.exitCode).toBe(0);
  });

  it('declara postgres e localstack com healthcheck no profile default', async () => {
    const result = await run(['docker', 'compose', 'config', '--format', 'json']);
    const config = JSON.parse(result.stdout) as {
      services: Record<string, { healthcheck?: unknown; profiles?: string[] }>;
    };

    expect(config.services['postgres']?.healthcheck).toBeDefined();
    expect(config.services['localstack']?.healthcheck).toBeDefined();
    expect(config.services['postgres']?.profiles).toBeUndefined();
    expect(config.services['localstack']?.profiles).toBeUndefined();
  });

  it('declara postgres-test e localstack-test isolados no profile test', async () => {
    const result = await run([
      'docker',
      'compose',
      '--profile',
      'test',
      'config',
      '--format',
      'json',
    ]);
    const config = JSON.parse(result.stdout) as {
      services: Record<string, { profiles?: string[]; ports?: { published: string }[] }>;
    };

    expect(config.services['postgres-test']?.profiles).toContain('test');
    expect(config.services['localstack-test']?.profiles).toContain('test');

    const devPort = config.services['postgres']?.ports?.[0]?.published;
    const testPort = config.services['postgres-test']?.ports?.[0]?.published;
    expect(testPort).not.toBe(devPort);
  });
});
