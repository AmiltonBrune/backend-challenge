import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReferenceNotProcessedError extends BusinessRuleViolationError {
  constructor(referenceExternalTransactionId: string, referenceStatus: string) {
    super(
      `Referência ${referenceExternalTransactionId} está ${referenceStatus}, não PROCESSED.`,
      FailureCode.REFERENCE_NOT_PROCESSED,
    );
  }
}
