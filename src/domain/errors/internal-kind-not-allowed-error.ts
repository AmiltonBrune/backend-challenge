import { BusinessRuleViolationError } from './business-rule-violation-error.ts';
import { FailureCode } from './failure-code.ts';

export class InternalKindNotAllowedError extends BusinessRuleViolationError {
  constructor(kind: string) {
    super(`Kind ${kind} não pode ser submetido por um canal externo.`, FailureCode.INTERNAL_KIND_NOT_ALLOWED);
  }
}
