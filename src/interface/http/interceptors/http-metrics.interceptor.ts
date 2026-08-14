import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import type { Request, Response } from 'express';
import { METRICS_PORT } from '@application/ports/metrics-port.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';

const NANOSECONDS_PER_SECOND = 1e9;

function routeLabel(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : request.url;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(@Inject(METRICS_PORT) private readonly metrics: MetricsPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    const record = (): void => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_SECOND;
      this.metrics.observeHttpRequestDuration({
        method: request.method,
        route: routeLabel(request),
        statusCode: response.statusCode,
        durationSeconds,
      });
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
