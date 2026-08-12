import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReferenceContextMismatchError extends BusinessRuleViolationError {
  constructor(field: string) {
    super(`Contexto divergente da referência no campo ${field}.`, FailureCode.REFERENCE_CONTEXT_MISMATCH);
  }
}
