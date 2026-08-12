import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class CurrencyMismatchError extends BusinessRuleViolationError {
  constructor(expected: string, actual: string) {
    super(`Moeda divergente: esperada ${expected}, recebida ${actual}.`, FailureCode.CURRENCY_MISMATCH);
  }
}
