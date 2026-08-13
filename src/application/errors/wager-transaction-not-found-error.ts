export class WagerTransactionNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Transação não encontrada: ${identifier}.`);
    this.name = new.target.name;
  }
}
