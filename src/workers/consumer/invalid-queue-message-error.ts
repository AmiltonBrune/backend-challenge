export class InvalidQueueMessageError extends Error {
  constructor(reason: string) {
    super(`Mensagem da fila inválida: ${reason}.`);
    this.name = new.target.name;
  }
}
