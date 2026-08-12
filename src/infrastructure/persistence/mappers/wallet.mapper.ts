import { Money } from '@domain/money/money.ts';
import { Wallet } from '@domain/wallet/wallet.ts';
import type { WalletEntity } from '../entities/wallet.entity.ts';

export interface WalletTimestamps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WalletMapper {
  static toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({ amount: entity.balanceAmount, currency: entity.currency }),
      version: entity.version,
    });
  }

  static toEntity(wallet: Wallet, timestamps: WalletTimestamps): WalletEntity {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balanceAmount: wallet.balance().toJSON().amount,
      version: wallet.version(),
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    };
  }
}
