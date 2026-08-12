import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReferenceAmountMismatchError extends BusinessRuleViolationError {
  constructor(expectedAmount: string, actualAmount: string) {
    super(
      `Valor divergente da referência: esperado ${expectedAmount}, recebido ${actualAmount}.`,
      FailureCode.REFERENCE_AMOUNT_MISMATCH,
    );
  }
}
