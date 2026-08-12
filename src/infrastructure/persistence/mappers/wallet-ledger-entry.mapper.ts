import type { LedgerDirection } from '@domain/ledger/ledger-direction.ts';
import { WalletLedgerEntry } from '@domain/ledger/wallet-ledger-entry.ts';
import { Money } from '@domain/money/money.ts';
import type { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.ts';

export class WalletLedgerEntryMapper {
  static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction as LedgerDirection,
      money: Money.from({ amount: entity.moneyAmount, currency: entity.currency }),
      balanceBefore: Money.from({ amount: entity.balanceBeforeAmount, currency: entity.currency }),
      balanceAfter: Money.from({ amount: entity.balanceAfterAmount, currency: entity.currency }),
      createdAt: entity.createdAt,
    });
  }

  static toEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    return {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      moneyAmount: entry.money.toJSON().amount,
      balanceBeforeAmount: entry.balanceBefore.toJSON().amount,
      balanceAfterAmount: entry.balanceAfter.toJSON().amount,
      currency: entry.money.toJSON().currency,
      createdAt: entry.createdAt,
    };
  }
}
