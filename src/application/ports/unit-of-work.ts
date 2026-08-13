import type { TransactionContext } from './transaction-context.ts';

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface UnitOfWork {
  run<T>(work: (ctx: TransactionContext) => Promise<T>, isolationLevel?: IsolationLevel): Promise<T>;
}
