import { describe, expect, it } from 'bun:test';
import { DomainError } from '@domain/errors/domain-error.ts';
import { BusinessRuleViolationError } from '@domain/errors/business-rule-violation-error.ts';
import { FailureCode } from '@domain/errors/failure-code.ts';
import { InsufficientFundsError } from '@domain/errors/insufficient-funds-error.ts';
import { ReversalWouldOverdrawError } from '@domain/errors/reversal-would-overdraw-error.ts';
import { CurrencyMismatchError } from '@domain/errors/currency-mismatch-error.ts';
import { InvalidTransactionStateError } from '@domain/errors/invalid-transaction-state-error.ts';
import { ReferenceNotFoundError } from '@domain/errors/reference-not-found-error.ts';
import { ReferenceAlreadyReversedError } from '@domain/errors/reference-already-reversed-error.ts';
import { ReferenceKindNotReversibleError } from '@domain/errors/reference-kind-not-reversible-error.ts';
import { ReferenceAmountMismatchError } from '@domain/errors/reference-amount-mismatch-error.ts';
import { ReferenceContextMismatchError } from '@domain/errors/reference-context-mismatch-error.ts';
import { ReferenceNotProcessedError } from '@domain/errors/reference-not-processed-error.ts';
import { PlayerWalletMismatchError } from '@domain/errors/player-wallet-mismatch-error.ts';
import { InternalKindNotAllowedError } from '@domain/errors/internal-kind-not-allowed-error.ts';

describe('FailureCode', () => {
  it('contém exatamente os doze códigos da taxonomia', () => {
    const codes: string[] = Object.values(FailureCode).sort();

    expect(codes).toEqual(
      [
        'CURRENCY_MISMATCH',
        'INSUFFICIENT_FUNDS',
        'INTERNAL_KIND_NOT_ALLOWED',
        'PLAYER_WALLET_MISMATCH',
        'REFERENCE_ALREADY_REVERSED',
        'REFERENCE_AMOUNT_MISMATCH',
        'REFERENCE_CONTEXT_MISMATCH',
        'REFERENCE_KIND_NOT_REVERSIBLE',
        'REFERENCE_NOT_FOUND',
        'REFERENCE_NOT_PROCESSED',
        'REVERSAL_WOULD_OVERDRAW',
        'WALLET_NOT_FOUND',
      ].sort(),
    );
  });
});

describe('DomainError', () => {
  it('nao pode ser lancada diretamente — apenas subclasses concretas existem', () => {
    expect(new InsufficientFundsError('80.00', '20.00', 'BRL')).toBeInstanceOf(DomainError);
  });
});

const businessRuleCases: readonly [string, () => BusinessRuleViolationError, FailureCode][] = [
  [
    'InsufficientFundsError',
    () => new InsufficientFundsError('80.00', '20.00', 'BRL'),
    FailureCode.INSUFFICIENT_FUNDS,
  ],
  [
    'ReversalWouldOverdrawError',
    () => new ReversalWouldOverdrawError('50.00', '10.00', 'BRL'),
    FailureCode.REVERSAL_WOULD_OVERDRAW,
  ],
  [
    'CurrencyMismatchError',
    () => new CurrencyMismatchError('BRL', 'USD'),
    FailureCode.CURRENCY_MISMATCH,
  ],
  [
    'ReferenceNotFoundError',
    () => new ReferenceNotFoundError('tx-bet-1'),
    FailureCode.REFERENCE_NOT_FOUND,
  ],
  [
    'ReferenceAlreadyReversedError',
    () => new ReferenceAlreadyReversedError('tx-bet-1', 'REFUND'),
    FailureCode.REFERENCE_ALREADY_REVERSED,
  ],
  [
    'ReferenceKindNotReversibleError',
    () => new ReferenceKindNotReversibleError('WIN', 'REFUND'),
    FailureCode.REFERENCE_KIND_NOT_REVERSIBLE,
  ],
  [
    'ReferenceAmountMismatchError',
    () => new ReferenceAmountMismatchError('80.00', '75.00'),
    FailureCode.REFERENCE_AMOUNT_MISMATCH,
  ],
  [
    'ReferenceContextMismatchError',
    () => new ReferenceContextMismatchError('walletId'),
    FailureCode.REFERENCE_CONTEXT_MISMATCH,
  ],
  [
    'ReferenceNotProcessedError',
    () => new ReferenceNotProcessedError('tx-bet-1', 'REJECTED'),
    FailureCode.REFERENCE_NOT_PROCESSED,
  ],
  [
    'PlayerWalletMismatchError',
    () => new PlayerWalletMismatchError('player-1', 'wallet-1'),
    FailureCode.PLAYER_WALLET_MISMATCH,
  ],
  [
    'InternalKindNotAllowedError',
    () => new InternalKindNotAllowedError('OPENING'),
    FailureCode.INTERNAL_KIND_NOT_ALLOWED,
  ],
];

describe('erros de regra de negócio', () => {
  for (const [className, build, expectedCode] of businessRuleCases) {
    it(`${className} é DomainError, BusinessRuleViolationError e carrega ${expectedCode}`, () => {
      const error = build();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(BusinessRuleViolationError);
      expect(error.failureCode).toBe(expectedCode);
      expect(error.name).toBe(className);
      expect(error.message.length).toBeGreaterThan(0);
    });
  }
});

describe('InvalidTransactionStateError', () => {
  it('e DomainError mas nao carrega failureCode — e erro de programacao, nao rejeicao de negocio', () => {
    const error = new InvalidTransactionStateError('PROCESSED', 'reject');

    expect(error).toBeInstanceOf(DomainError);
    expect(error).not.toBeInstanceOf(BusinessRuleViolationError);
    expect((error as unknown as Record<string, unknown>)['failureCode']).toBeUndefined();
    expect(error.name).toBe('InvalidTransactionStateError');
  });
});
