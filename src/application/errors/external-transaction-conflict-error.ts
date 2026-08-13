import { PersistenceConflictError } from './persistence-conflict-error.ts';

export class ExternalTransactionConflictError extends PersistenceConflictError {
  constructor(
    public readonly providerId: string,
    public readonly externalTransactionId: string,
  ) {
    super(
      `Já existe uma transação de ${providerId} com externalTransactionId ${externalTransactionId}.`,
    );
  }
}
