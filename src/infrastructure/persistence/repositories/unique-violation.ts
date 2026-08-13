import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

export function constraintNameOf(error: unknown): string | undefined {
  if (!(error instanceof QueryFailedError)) {
    return undefined;
  }
  const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
  if (driverError?.code !== UNIQUE_VIOLATION) {
    return undefined;
  }
  return driverError.constraint;
}
