import { DomainError } from './domain-error.ts';

export class InvalidTransactionStateError extends DomainError {
  constructor(currentStatus: string, attemptedTransition: string) {
    super(`Transição inválida: "${attemptedTransition}" a partir do estado ${currentStatus}.`);
  }
}
