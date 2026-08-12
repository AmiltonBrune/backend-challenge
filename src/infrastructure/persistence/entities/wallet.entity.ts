import { Column, Entity, PrimaryColumn } from 'typeorm';
import { moneyAmountTransformer } from '../money-amount.transformer.ts';

@Entity({ name: 'wallets' })
export class WalletEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'currency', type: 'char', length: 3 })
  currency!: string;

  @Column({
    name: 'balance_amount',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: moneyAmountTransformer,
  })
  balanceAmount!: string;

  @Column({ name: 'version', type: 'int' })
  version!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
