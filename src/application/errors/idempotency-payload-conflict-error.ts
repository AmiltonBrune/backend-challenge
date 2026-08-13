import { PersistenceConflictError } from './persistence-conflict-error.ts';

export class IdempotencyPayloadConflictError extends PersistenceConflictError {
  constructor(
    public readonly providerId: string,
    public readonly idempotencyKey: string,
  ) {
    super(
      `A chave de idempotência ${idempotencyKey} de ${providerId} já foi usada com um payload diferente.`,
    );
  }
}
