import { describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { WalletEntity } from '@infrastructure/persistence/entities/wallet.entity.ts';
import { WagerTransactionEntity } from '@infrastructure/persistence/entities/wager-transaction.entity.ts';
import { WalletLedgerEntryEntity } from '@infrastructure/persistence/entities/wallet-ledger-entry.entity.ts';
import { InboxMessageEntity } from '@infrastructure/persistence/entities/inbox-message.entity.ts';
import { OutboxMessageEntity } from '@infrastructure/persistence/entities/outbox-message.entity.ts';

type EntityClass = new (...args: never[]) => unknown;

const storage = getMetadataArgsStorage();

function tableNameOf(target: EntityClass): string | undefined {
  const table = storage.tables.find((t) => t.target === target);
  return typeof table?.name === 'string' ? table.name : undefined;
}

interface ColumnSummary {
  readonly name: string | undefined;
  readonly precision: number | undefined;
  readonly scale: number | undefined;
}

function columnsOf(target: EntityClass): Map<string, ColumnSummary> {
  const map = new Map<string, ColumnSummary>();
  for (const column of storage.columns.filter((c) => c.target === target)) {
    map.set(column.propertyName, {
      name: typeof column.options.name === 'string' ? column.options.name : undefined,
      precision: column.options.precision ?? undefined,
      scale: column.options.scale ?? undefined,
    });
  }
  return map;
}

describe('WalletEntity', () => {
  it('mapeia para a tabela wallets', () => {
    expect(tableNameOf(WalletEntity)).toBe('wallets');
  });

  it('colunas em snake_case correspondem ao schema', () => {
    const columns = columnsOf(WalletEntity);

    expect(columns.get('playerId')?.name).toBe('player_id');
    expect(columns.get('balanceAmount')?.name).toBe('balance_amount');
  });

  it('balanceAmount e numeric(19,2)', () => {
    const columns = columnsOf(WalletEntity);

    expect(columns.get('balanceAmount')?.precision).toBe(19);
    expect(columns.get('balanceAmount')?.scale).toBe(2);
  });

  it('nao usa @VersionColumn — version e coluna comum', () => {
    const versionColumns = storage.columns.filter(
      (c) => c.target === WalletEntity && c.mode === 'version',
    );

    expect(versionColumns).toHaveLength(0);
  });
});

describe('WagerTransactionEntity', () => {
  it('mapeia para a tabela wager_transactions', () => {
    expect(tableNameOf(WagerTransactionEntity)).toBe('wager_transactions');
  });

  it('colunas em snake_case correspondem ao schema', () => {
    const columns = columnsOf(WagerTransactionEntity);

    expect(columns.get('externalTransactionId')?.name).toBe('external_transaction_id');
    expect(columns.get('idempotencyKey')?.name).toBe('idempotency_key');
    expect(columns.get('referenceExternalTransactionId')?.name).toBe(
      'reference_external_transaction_id',
    );
    expect(columns.get('referenceTransactionId')?.name).toBe('reference_transaction_id');
    expect(columns.get('failureCode')?.name).toBe('failure_code');
  });

  it('moneyAmount e numeric(19,2)', () => {
    const columns = columnsOf(WagerTransactionEntity);

    expect(columns.get('moneyAmount')?.precision).toBe(19);
    expect(columns.get('moneyAmount')?.scale).toBe(2);
  });
});

describe('WalletLedgerEntryEntity', () => {
  it('mapeia para a tabela wallet_ledger_entries', () => {
    expect(tableNameOf(WalletLedgerEntryEntity)).toBe('wallet_ledger_entries');
  });

  it('as tres colunas monetarias sao numeric(19,2)', () => {
    const columns = columnsOf(WalletLedgerEntryEntity);

    for (const prop of ['moneyAmount', 'balanceBeforeAmount', 'balanceAfterAmount']) {
      expect(columns.get(prop)?.precision).toBe(19);
      expect(columns.get(prop)?.scale).toBe(2);
    }
  });
});

describe('InboxMessageEntity', () => {
  it('mapeia para a tabela inbox_messages', () => {
    expect(tableNameOf(InboxMessageEntity)).toBe('inbox_messages');
  });

  it('consumerName e messageId sao ambos chave primaria', () => {
    const primaryColumns = storage.columns.filter(
      (c) => c.target === InboxMessageEntity && c.mode === 'regular' && c.options.primary === true,
    );
    const propertyNames = primaryColumns.map((c) => c.propertyName).sort();

    expect(propertyNames).toEqual(['consumerName', 'messageId']);
  });
});

describe('OutboxMessageEntity', () => {
  it('mapeia para a tabela outbox_messages', () => {
    expect(tableNameOf(OutboxMessageEntity)).toBe('outbox_messages');
  });

  it('payload e jsonb', () => {
    const column = storage.columns.find(
      (c) => c.target === OutboxMessageEntity && c.propertyName === 'payload',
    );

    expect(column?.options.type).toBe('jsonb');
  });
});
