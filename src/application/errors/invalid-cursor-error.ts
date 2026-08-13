export class InvalidCursorError extends Error {
  constructor(cursor: string) {
    super(`Cursor de paginação inválido: ${cursor}.`);
    this.name = new.target.name;
  }
}
