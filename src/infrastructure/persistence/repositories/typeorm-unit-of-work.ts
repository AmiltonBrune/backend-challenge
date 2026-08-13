import type { DataSource } from 'typeorm';
import type { IsolationLevel, TransactionContext, UnitOfWork } from '@application/ports/index.ts';

type TypeOrmIsolationLevel = Parameters<DataSource['transaction']> extends [infer L, ...unknown[]]
  ? L
  : never;

export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(
    work: (ctx: TransactionContext) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    if (isolationLevel !== undefined) {
      return this.dataSource.transaction(isolationLevel as TypeOrmIsolationLevel, (manager) =>
        work(manager),
      );
    }
    return this.dataSource.transaction((manager) => work(manager));
  }
}
