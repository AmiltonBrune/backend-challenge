import { FailureCode } from '@domain/errors/failure-code.ts';

export interface CatalogedError {
  readonly error: string;
  readonly message: string;
}

const FAILURE_CODE_CATALOG: Record<FailureCode, CatalogedError> = {
  [FailureCode.INSUFFICIENT_FUNDS]: {
    error: 'ERR-014',
    message: 'Saldo insuficiente para a operação solicitada.',
  },
  [FailureCode.REVERSAL_WOULD_OVERDRAW]: {
    error: 'ERR-015',
    message: 'A reversão deixaria o saldo negativo.',
  },
  [FailureCode.CURRENCY_MISMATCH]: {
    error: 'ERR-016',
    message: 'Moeda da operação difere da moeda da carteira.',
  },
  [FailureCode.REFERENCE_NOT_FOUND]: {
    error: 'ERR-017',
    message: 'Operação referenciada não localizada no prazo.',
  },
  [FailureCode.REFERENCE_ALREADY_REVERSED]: {
    error: 'ERR-018',
    message: 'Operação referenciada já revertida por este tipo.',
  },
  [FailureCode.REFERENCE_KIND_NOT_REVERSIBLE]: {
    error: 'ERR-019',
    message: 'Tipo da operação referenciada não admite esta reversão.',
  },
  [FailureCode.REFERENCE_AMOUNT_MISMATCH]: {
    error: 'ERR-020',
    message: 'Valor difere do valor da operação referenciada.',
  },
  [FailureCode.REFERENCE_CONTEXT_MISMATCH]: {
    error: 'ERR-021',
    message: 'Operação referenciada pertence a outro contexto.',
  },
  [FailureCode.REFERENCE_NOT_PROCESSED]: {
    error: 'ERR-022',
    message: 'Operação referenciada não foi aplicada.',
  },
  [FailureCode.PLAYER_WALLET_MISMATCH]: {
    error: 'ERR-023',
    message: 'Jogador informado não é titular da carteira.',
  },
  [FailureCode.WALLET_NOT_FOUND]: {
    error: 'ERR-006',
    message: 'Carteira não encontrada.',
  },
  [FailureCode.INTERNAL_KIND_NOT_ALLOWED]: {
    error: 'ERR-011',
    message: 'Tipo de operação reservado ao uso interno.',
  },
};

export function catalogFailureCode(failureCode: FailureCode): CatalogedError {
  return FAILURE_CODE_CATALOG[failureCode];
}
