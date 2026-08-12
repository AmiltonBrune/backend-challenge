import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class ReferenceKindNotReversibleError extends BusinessRuleViolationError {
  constructor(referenceKind: string, attemptedKind: string) {
    super(
      `${attemptedKind} não pode referenciar uma transação do tipo ${referenceKind}.`,
      FailureCode.REFERENCE_KIND_NOT_REVERSIBLE,
    );
  }
}
