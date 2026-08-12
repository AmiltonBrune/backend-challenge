import { DomainError } from './domain-error.ts';

export class InvalidOutboxMessageError extends DomainError {
  constructor(reason: string) {
    super(`Mensagem de outbox inválida: ${reason}.`);
  }
}
