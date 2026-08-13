import type { EntityManager } from 'typeorm';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { LedgerCursor } from '@application/dto/ledger-cursor.ts';
import { encodeLedgerCursor } from '@application/dto/ledger-cursor.ts';
import type { LedgerPage } from '@application/dto/ledger-page.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.ts';
import { WalletLedgerEntryMapper } from '../mappers/wallet-ledger-entry.mapper.ts';

interface LedgerRow {
  readonly id: string;
  readonly wallet_id: string;
  readonly transaction_id: string;
  readonly direction: string;
  readonly money_amount: string;
  readonly balance_before_amount: string;
  readonly balance_after_amount: string;
  readonly currency: string;
  readonly created_at: Date;
}

function rowToEntity(row: LedgerRow): WalletLedgerEntryEntity {
  return {
    id: row.id,
    walletId: row.wallet_id,
    transactionId: row.transaction_id,
    direction: row.direction,
    moneyAmount: row.money_amount,
    balanceBeforeAmount: row.balance_before_amount,
    balanceAfterAmount: row.balance_after_amount,
    currency: row.currency,
    createdAt: row.created_at,
  };
}

export class TypeOrmLedgerRepository implements LedgerRepository {
  async insert(ctx: TransactionContext, entry: WalletLedgerEntry): Promise<void> {
    const manager = ctx as EntityManager;
    await manager.insert(WalletLedgerEntryEntity, WalletLedgerEntryMapper.toEntity(entry));
  }

  async findByTransactionId(
    ctx: TransactionContext,
    transactionId: string,
  ): Promise<WalletLedgerEntry | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WalletLedgerEntryEntity, { where: { transactionId } });
    return entity === null ? undefined : WalletLedgerEntryMapper.toDomain(entity);
  }

  async sumByWalletId(
    ctx: TransactionContext,
    walletId: string,
    currency: string,
  ): Promise<Money> {
    const manager = ctx as EntityManager;
    const rows = await manager.query<{ net: string }[]>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN money_amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN money_amount ELSE 0 END), 0) AS net
       FROM wallet_ledger_entries
       WHERE wallet_id = $1`,
      [walletId],
    );
    const row = rows[0];
    if (row === undefined) {
      return Money.zero(currency);
    }
    const isNegative = row.net.startsWith('-');
    const magnitude = Money.from({
      amount: isNegative ? row.net.slice(1) : row.net,
      currency,
    });
    return isNegative ? magnitude.negate() : magnitude;
  }

  async countByWalletId(ctx: TransactionContext, walletId: string): Promise<number> {
    const manager = ctx as EntityManager;
    return manager.count(WalletLedgerEntryEntity, { where: { walletId } });
  }

  async findPageByWalletId(
    ctx: TransactionContext,
    walletId: string,
    cursor: LedgerCursor | undefined,
    limit: number,
  ): Promise<LedgerPage> {
    const manager = ctx as EntityManager;
    const rows = await manager.query<LedgerRow[]>(
      `SELECT id, wallet_id, transaction_id, direction, money_amount,
              balance_before_amount, balance_after_amount, currency, created_at
       FROM wallet_ledger_entries
       WHERE wallet_id = $1
         AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [walletId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const entries = page.map((row) => WalletLedgerEntryMapper.toDomain(rowToEntity(row)));
    const last = page[page.length - 1];

    return {
      entries,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeLedgerCursor({ createdAt: last.created_at.toISOString(), id: last.id })
          : undefined,
    };
  }
}
