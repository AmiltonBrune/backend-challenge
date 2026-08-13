const CONNECTION_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  '57P03',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
]);

interface DriverErrorLike {
  readonly code?: unknown;
  readonly driverError?: unknown;
}

function extractCode(error: Error): string | undefined {
  const candidate = error as Error & DriverErrorLike;
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  if (candidate.driverError instanceof Error) {
    return extractCode(candidate.driverError);
  }
  return undefined;
}

export function isInfrastructureUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = extractCode(error);
  return code !== undefined && CONNECTION_FAILURE_CODES.has(code);
}
