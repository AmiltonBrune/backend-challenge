import { Column, Entity, PrimaryColumn } from 'typeorm';
import { moneyAmountTransformer } from '../money-amount.transformer.ts';

@Entity({ name: 'wallet_ledger_entries' })
export class WalletLedgerEntryEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @Column({ name: 'direction', type: 'text' })
  direction!: string;

  @Column({
    name: 'money_amount',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: moneyAmountTransformer,
  })
  moneyAmount!: string;

  @Column({
    name: 'balance_before_amount',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: moneyAmountTransformer,
  })
  balanceBeforeAmount!: string;

  @Column({
    name: 'balance_after_amount',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: moneyAmountTransformer,
  })
  balanceAfterAmount!: string;

  @Column({ name: 'currency', type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
