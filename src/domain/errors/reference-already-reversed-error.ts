import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReferenceAlreadyReversedError extends BusinessRuleViolationError {
  constructor(referenceExternalTransactionId: string, kind: string) {
    super(
      `Referência ${referenceExternalTransactionId} já revertida por ${kind}.`,
      FailureCode.REFERENCE_ALREADY_REVERSED,
    );
  }
}
