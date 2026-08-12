import { DomainError } from './domain-error.ts';

export class InvalidWagerTransactionError extends DomainError {
  constructor(reason: string) {
    super(`Transação inválida: ${reason}.`);
  }
}
