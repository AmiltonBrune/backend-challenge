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

async function dockerComposeAvailable(): Promise<boolean> {
  try {
    const result = await run(['docker', 'compose', 'version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const hasDockerCompose = await dockerComposeAvailable();
const describeIfDocker = hasDockerCompose ? describe : describe.skip;

describeIfDocker('docker compose — stack de desenvolvimento', () => {
  it('a configuração é válida', async () => {
    const result = await run(['docker', 'compose', 'config', '--quiet']);
    expect(result.exitCode).toBe(0);
  });

  it('declara apenas postgres e localstack, com healthcheck', async () => {
    const result = await run(['docker', 'compose', 'config', '--format', 'json']);
    const config = JSON.parse(result.stdout) as {
      services: Record<string, { healthcheck?: unknown }>;
    };

    expect(Object.keys(config.services).sort()).toEqual(['localstack', 'postgres']);
    expect(config.services['postgres']?.healthcheck).toBeDefined();
    expect(config.services['localstack']?.healthcheck).toBeDefined();
  });
});

describeIfDocker('docker compose — stack de teste isolada', () => {
  const testFlags = ['-f', 'docker-compose.test.yml'];

  it('a configuração é válida isoladamente', async () => {
    const result = await run(['docker', 'compose', ...testFlags, 'config', '--quiet']);
    expect(result.exitCode).toBe(0);
  });

  it('declara apenas postgres-test e localstack-test, em portas distintas da stack de dev', async () => {
    const result = await run(['docker', 'compose', ...testFlags, 'config', '--format', 'json']);
    const config = JSON.parse(result.stdout) as {
      services: Record<string, { ports?: { published: string }[] }>;
    };

    expect(Object.keys(config.services).sort()).toEqual(['localstack-test', 'postgres-test']);

    const devConfig = JSON.parse(
      (await run(['docker', 'compose', 'config', '--format', 'json'])).stdout,
    ) as { services: Record<string, { ports?: { published: string }[] }> };

    const testPgPort = config.services['postgres-test']?.ports?.[0]?.published;
    const devPgPort = devConfig.services['postgres']?.ports?.[0]?.published;
    expect(testPgPort).not.toBe(devPgPort);
  });

  it('subir a stack de teste não inicia a stack de dev', async () => {
    const result = await run(['docker', 'compose', ...testFlags, 'config', '--services']);
    const services = result.stdout.trim().split('\n').sort();

    expect(services).toEqual(['localstack-test', 'postgres-test']);
  });
});
