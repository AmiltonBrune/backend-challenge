import { InvalidCursorError } from '@application/errors/invalid-cursor-error.ts';

export interface LedgerCursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeLedgerCursor(encoded: string): LedgerCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  } catch {
    throw new InvalidCursorError(encoded);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['createdAt'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['id'] !== 'string'
  ) {
    throw new InvalidCursorError(encoded);
  }

  return parsed as LedgerCursor;
}
