import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class InsufficientFundsError extends BusinessRuleViolationError {
  constructor(requiredAmount: string, availableAmount: string, currency: string) {
    super(
      `Saldo insuficiente: requerido ${requiredAmount} ${currency}, disponível ${availableAmount} ${currency}.`,
      FailureCode.INSUFFICIENT_FUNDS,
    );
  }
}
