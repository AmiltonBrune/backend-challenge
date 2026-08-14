import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { LivenessState } from '@application/health/liveness-state.ts';
import { CheckReadinessUseCase } from '@application/use-cases/check-readiness-use-case.ts';
import type { ReadinessResult } from '@application/use-cases/check-readiness-use-case.ts';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly livenessState: LivenessState,
    private readonly checkReadiness: CheckReadinessUseCase,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — o processo está de pé.' })
  @ApiResponse({ status: 200, description: 'Saudável.' })
  @ApiResponse({ status: 503, description: 'Não saudável.' })
  live(@Res({ passthrough: true }) res: Response): { status: 'up' | 'error' } {
    const healthy = this.livenessState.isHealthy();
    res.status(healthy ? 200 : 503);
    return { status: healthy ? 'up' : 'error' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — dependências (Postgres, SQS) acessíveis.' })
  @ApiResponse({ status: 200, description: 'Pronto.' })
  @ApiResponse({ status: 503, description: 'Não pronto.' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResult> {
    const result = await this.checkReadiness.execute();
    res.status(result.status === 'up' ? 200 : 503);
    return result;
  }
}
