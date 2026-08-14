import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { METRICS_PORT } from '@application/ports/metrics-port.ts';
import type { MetricsPort } from '@application/ports/metrics-port.ts';

@ApiTags('observability')
@Controller()
export class MetricsController {
  constructor(@Inject(METRICS_PORT) private readonly metrics: MetricsPort) {}

  @Get('metrics')
  @ApiExcludeEndpoint()
  async metricsExposition(@Res({ passthrough: true }) res: Response): Promise<string> {
    const { contentType, body } = await this.metrics.exposition();
    res.setHeader('Content-Type', contentType);
    return body;
  }
}
