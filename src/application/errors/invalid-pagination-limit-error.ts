export class InvalidPaginationLimitError extends Error {
  constructor(limit: number) {
    super(`Limite de paginação inválido: ${limit}. Deve estar entre 1 e 100.`);
    this.name = new.target.name;
  }
}
