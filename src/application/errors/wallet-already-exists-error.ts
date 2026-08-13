import { PersistenceConflictError } from './persistence-conflict-error.ts';

export class WalletAlreadyExistsError extends PersistenceConflictError {
  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`Já existe uma wallet para o jogador ${playerId} na moeda ${currency}.`);
  }
}
