import type { TransactionContext } from './transaction-context.ts';

export interface UnitOfWork {
  run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}
