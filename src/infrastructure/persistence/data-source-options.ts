import { fileURLToPath } from 'node:url';
import type { DataSourceOptions } from 'typeorm';
import {
  InboxMessageEntity,
  OutboxMessageEntity,
  WagerTransactionEntity,
  WalletEntity,
  WalletLedgerEntryEntity,
} from './entities/index.ts';

const migrationsDir = fileURLToPath(new URL('./migrations/*.ts', import.meta.url));

export interface DataSourceOptionsParams {
  readonly databaseUrl: string;
  readonly poolSize: number;
  readonly statementTimeoutMs: number;
}

export function buildDataSourceOptions(params: DataSourceOptionsParams): DataSourceOptions {
  return {
    type: 'postgres',
    url: params.databaseUrl,
    synchronize: false,
    entities: [
      WalletEntity,
      WagerTransactionEntity,
      WalletLedgerEntryEntity,
      InboxMessageEntity,
      OutboxMessageEntity,
    ],
    migrations: [migrationsDir],
    extra: {
      max: params.poolSize,
      statement_timeout: params.statementTimeoutMs,
    },
  };
}
