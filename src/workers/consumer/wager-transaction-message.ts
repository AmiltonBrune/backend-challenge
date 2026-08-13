import type { ProcessWagerTransactionInput } from '@application/use-cases/process-wager-transaction-use-case.ts';
import type { MoneyProps } from '@domain/money/money-props.ts';
import { WagerTransactionKind } from '@domain/wager-transaction/wager-transaction-kind.ts';
import { InvalidQueueMessageError } from './invalid-queue-message-error.ts';

const REQUIRED_STRING_FIELDS = [
  'idempotencyKey',
  'providerId',
  'externalTransactionId',
  'playerId',
  'walletId',
  'roundId',
  'gameId',
] as const;

const KINDS_REQUIRING_REFERENCE = new Set([WagerTransactionKind.REFUND, WagerTransactionKind.ROLLBACK]);
const VALID_KINDS = new Set<string>(Object.values(WagerTransactionKind));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isMoneyProps(value: unknown): value is MoneyProps {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['amount'] === 'string' &&
    typeof (value as Record<string, unknown>)['currency'] === 'string'
  );
}

export function parseWagerTransactionMessage(raw: string): ProcessWagerTransactionInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidQueueMessageError('corpo da mensagem não é um JSON válido');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidQueueMessageError('corpo da mensagem deve ser um objeto');
  }

  const body = parsed as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(body[field])) {
      throw new InvalidQueueMessageError(`campo obrigatório ausente ou inválido: ${field}`);
    }
  }

  const kind = body['kind'];
  if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
    throw new InvalidQueueMessageError(`kind desconhecido: ${String(kind)}`);
  }

  const money = body['money'];
  if (!isMoneyProps(money)) {
    throw new InvalidQueueMessageError('campo money inválido');
  }

  const reference = body['referenceExternalTransactionId'];
  const hasReference = isNonEmptyString(reference);

  if (KINDS_REQUIRING_REFERENCE.has(kind as WagerTransactionKind) && !hasReference) {
    throw new InvalidQueueMessageError(
      'referenceExternalTransactionId é obrigatório para REFUND e ROLLBACK',
    );
  }

  return {
    declaredProviderId: body['providerId'] as string,
    idempotencyKey: body['idempotencyKey'] as string,
    externalTransactionId: body['externalTransactionId'] as string,
    playerId: body['playerId'] as string,
    walletId: body['walletId'] as string,
    roundId: body['roundId'] as string,
    gameId: body['gameId'] as string,
    kind: kind as WagerTransactionKind,
    money,
    ...(hasReference ? { referenceExternalTransactionId: reference } : {}),
  };
}
