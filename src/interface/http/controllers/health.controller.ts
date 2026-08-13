import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LivenessState } from '@application/health/liveness-state.ts';
import { CheckReadinessUseCase } from '@application/use-cases/check-readiness-use-case.ts';
import type { ReadinessResult } from '@application/use-cases/check-readiness-use-case.ts';

@Controller('health')
export class HealthController {
  constructor(
    private readonly livenessState: LivenessState,
    private readonly checkReadiness: CheckReadinessUseCase,
  ) {}

  @Get('live')
  live(@Res({ passthrough: true }) res: Response): { status: 'up' | 'error' } {
    const healthy = this.livenessState.isHealthy();
    res.status(healthy ? 200 : 503);
    return { status: healthy ? 'up' : 'error' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResult> {
    const result = await this.checkReadiness.execute();
    res.status(result.status === 'up' ? 200 : 503);
    return result;
  }
}
