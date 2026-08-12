import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReversalWouldOverdrawError extends BusinessRuleViolationError {
  constructor(requiredAmount: string, availableAmount: string, currency: string) {
    super(
      `Reversão deixaria saldo negativo: requerido ${requiredAmount} ${currency}, disponível ${availableAmount} ${currency}.`,
      FailureCode.REVERSAL_WOULD_OVERDRAW,
    );
  }
}
