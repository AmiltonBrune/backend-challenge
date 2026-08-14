import { describe } from 'bun:test';
import { GetQueueUrlCommand, type SQSClient } from '@aws-sdk/client-sqs';

const composeArgs = ['-f', 'docker-compose.test.yml'] as const;

export async function dockerComposeAvailable(): Promise<boolean> {
  try {
    const child = Bun.spawn(['docker', 'compose', 'version'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await child.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function runDockerCompose(args: readonly string[]): Promise<void> {
  const child = Bun.spawn(['docker', 'compose', ...composeArgs, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    throw new Error(`docker compose ${args.join(' ')} falhou: ${stderr}`);
  }
}

export const hasDockerCompose = await dockerComposeAvailable();
export const describeIfDocker = hasDockerCompose ? describe : describe.skip;

const QUEUE_POLL_INTERVAL_MS = 200;

export async function waitForQueue(
  client: SQSClient,
  queueName: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, QUEUE_POLL_INTERVAL_MS));
    }
  }
  throw new Error(`Fila ${queueName} não ficou disponível no LocalStack em ${timeoutMs}ms.`);
}
