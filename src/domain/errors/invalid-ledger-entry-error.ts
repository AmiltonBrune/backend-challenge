import { DomainError } from './domain-error.ts';

export class InvalidLedgerEntryError extends DomainError {
  constructor(reason: string) {
    super(`Lançamento de ledger inválido: ${reason}.`);
  }
}
