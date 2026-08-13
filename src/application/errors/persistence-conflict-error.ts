export abstract class PersistenceConflictError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
