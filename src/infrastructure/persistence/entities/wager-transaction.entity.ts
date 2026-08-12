import { Column, Entity, PrimaryColumn } from 'typeorm';
import { moneyAmountTransformer } from '../money-amount.transformer.ts';

@Entity({ name: 'wager_transactions' })
export class WagerTransactionEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @Column({ name: 'external_transaction_id', type: 'text' })
  externalTransactionId!: string;

  @Column({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string;

  @Column({ name: 'payload_hash', type: 'text' })
  payloadHash!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'round_id', type: 'text' })
  roundId!: string;

  @Column({ name: 'game_id', type: 'text', nullable: true })
  gameId!: string | null;

  @Column({ name: 'kind', type: 'text' })
  kind!: string;

  @Column({
    name: 'money_amount',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: moneyAmountTransformer,
  })
  moneyAmount!: string;

  @Column({ name: 'money_currency', type: 'char', length: 3 })
  moneyCurrency!: string;

  @Column({ name: 'reference_external_transaction_id', type: 'text', nullable: true })
  referenceExternalTransactionId!: string | null;

  @Column({ name: 'reference_transaction_id', type: 'uuid', nullable: true })
  referenceTransactionId!: string | null;

  @Column({ name: 'status', type: 'text' })
  status!: string;

  @Column({ name: 'failure_code', type: 'text', nullable: true })
  failureCode!: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
