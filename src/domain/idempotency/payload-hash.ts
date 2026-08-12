import { canonicalize } from './canonicalize.ts';
import type { PayloadHashInput } from './payload-hash-input.ts';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function extractClosedSubset(input: PayloadHashInput): Record<string, unknown> {
  const subset: Record<string, unknown> = {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: {
      amount: input.money.amount,
      currency: input.money.currency,
    },
  };

  if (input.referenceExternalTransactionId !== undefined) {
    subset['referenceExternalTransactionId'] = input.referenceExternalTransactionId;
  }

  return subset;
}

export async function computePayloadHash(input: PayloadHashInput): Promise<string> {
  const canonical = canonicalize(extractClosedSubset(input));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return toHex(new Uint8Array(digest));
}
