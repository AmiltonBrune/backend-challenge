import { DomainError } from './domain-error.ts';
import type { FailureCode } from './failure-code.ts';

export abstract class BusinessRuleViolationError extends DomainError {
  public readonly failureCode: FailureCode;

  protected constructor(message: string, failureCode: FailureCode) {
    super(message);
    this.failureCode = failureCode;
  }
}
