import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithCorrelationId } from './correlation-context.ts';

const CORRELATION_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerValue = req.header(CORRELATION_HEADER);
    const correlationId = headerValue !== undefined && headerValue.length > 0 ? headerValue : randomUUID();

    res.setHeader(CORRELATION_HEADER, correlationId);
    runWithCorrelationId(correlationId, next);
  }
}
