import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReferenceNotFoundError extends BusinessRuleViolationError {
  constructor(referenceExternalTransactionId: string) {
    super(
      `Referência não encontrada: ${referenceExternalTransactionId}.`,
      FailureCode.REFERENCE_NOT_FOUND,
    );
  }
}
