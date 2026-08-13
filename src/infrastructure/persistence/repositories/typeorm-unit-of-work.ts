import type { DataSource } from 'typeorm';
import type { TransactionContext, UnitOfWork } from '@application/ports/index.ts';

export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => work(manager));
  }
}
