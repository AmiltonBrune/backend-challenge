import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationStore {
  readonly correlationId: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
