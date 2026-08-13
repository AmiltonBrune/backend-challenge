import type { EntityManager } from 'typeorm';
import type { LedgerRepository } from '@application/ports/ledger-repository.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity.ts';
import { WalletLedgerEntryMapper } from './mappers/wallet-ledger-entry.mapper.ts';

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

  async sumByWalletId(ctx: TransactionContext, walletId: string): Promise<Money> {
    const manager = ctx as EntityManager;
    const rows = await manager.query<{ currency: string; net: string }[]>(
      `SELECT currency,
              COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN money_amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN money_amount ELSE 0 END), 0) AS net
       FROM wallet_ledger_entries
       WHERE wallet_id = $1
       GROUP BY currency`,
      [walletId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        `LedgerRepository.sumByWalletId: nenhum lançamento encontrado para a wallet ${walletId} — toda wallet aberta tem ao menos o lançamento OPENING.`,
      );
    }
    return Money.from({ amount: row.net, currency: row.currency });
  }
}
