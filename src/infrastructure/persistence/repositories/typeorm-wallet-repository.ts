import type { EntityManager } from 'typeorm';
import type { Clock } from '@application/ports/clock.ts';
import type { TransactionContext } from '@application/ports/transaction-context.ts';
import type { WalletRepository } from '@application/ports/wallet-repository.ts';
import { WalletAlreadyExistsError } from '@application/errors/wallet-already-exists-error.ts';
import type { Wallet } from '@domain/wallet/wallet.ts';
import { WalletEntity } from '../entities/wallet.entity.ts';
import { WalletMapper } from '../mappers/wallet.mapper.ts';
import { constraintNameOf } from './unique-violation.ts';

export class TypeOrmWalletRepository implements WalletRepository {
  constructor(private readonly clock: Clock) {}

  async findById(ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WalletEntity, { where: { id } });
    return entity === null ? undefined : WalletMapper.toDomain(entity);
  }

  async findByIdForUpdate(ctx: TransactionContext, id: string): Promise<Wallet | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WalletEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return entity === null ? undefined : WalletMapper.toDomain(entity);
  }

  async findByPlayerAndCurrency(
    ctx: TransactionContext,
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined> {
    const manager = ctx as EntityManager;
    const entity = await manager.findOne(WalletEntity, { where: { playerId, currency } });
    return entity === null ? undefined : WalletMapper.toDomain(entity);
  }

  async insert(ctx: TransactionContext, wallet: Wallet): Promise<void> {
    const manager = ctx as EntityManager;
    const now = this.clock.now();
    const entity = WalletMapper.toEntity(wallet, { createdAt: now, updatedAt: now });
    try {
      await manager.insert(WalletEntity, entity);
    } catch (error) {
      if (constraintNameOf(error) === 'uq_wallet_player_currency') {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }

  async update(ctx: TransactionContext, wallet: Wallet): Promise<void> {
    const manager = ctx as EntityManager;
    await manager.update(
      WalletEntity,
      { id: wallet.id },
      {
        balanceAmount: wallet.balance().toJSON().amount,
        version: wallet.version(),
        updatedAt: this.clock.now(),
      },
    );
  }
}
