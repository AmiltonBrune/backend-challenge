import { PersistenceConflictError } from './persistence-conflict-error.ts';

export class ConcurrentIdempotencyProcessingError extends PersistenceConflictError {
  constructor(
    public readonly providerId: string,
    public readonly idempotencyKey: string,
  ) {
    super(
      `A chave de idempotência ${idempotencyKey} de ${providerId} já está sendo processada.`,
    );
  }
}
