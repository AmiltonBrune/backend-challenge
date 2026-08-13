import { PersistenceConflictError } from './persistence-conflict-error.ts';

export class IdempotencyKeyConflictError extends PersistenceConflictError {
  constructor(
    public readonly providerId: string,
    public readonly idempotencyKey: string,
  ) {
    super(`Já existe uma transação de ${providerId} com idempotencyKey ${idempotencyKey}.`);
  }
}
