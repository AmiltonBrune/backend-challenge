import type { MetricsPort } from '@application/ports/metrics-port.ts';

export interface MetricsHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

export function startMetricsHttpServer(port: number, metrics: MetricsPort): MetricsHttpServer {
  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/metrics') {
        return new Response('not found', { status: 404 });
      }
      const { contentType, body } = await metrics.exposition();
      return new Response(body, { headers: { 'content-type': contentType } });
    },
  });

  if (server.port === undefined) {
    throw new Error('servidor de métricas não conseguiu resolver uma porta TCP.');
  }

  return {
    port: server.port,
    async close(): Promise<void> {
      await server.stop(true);
    },
  };
}
