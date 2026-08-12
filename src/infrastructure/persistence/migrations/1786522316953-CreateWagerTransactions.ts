import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWagerTransactions1786522316953 implements MigrationInterface {
  name = 'CreateWagerTransactions1786522316953';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wager_transactions (
        id uuid PRIMARY KEY,
        provider_id text NOT NULL,
        external_transaction_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        wallet_id uuid NOT NULL REFERENCES wallets(id),
        player_id uuid NOT NULL,
        round_id text NOT NULL,
        game_id text,
        kind text NOT NULL,
        money_amount numeric(19,2) NOT NULL,
        money_currency char(3) NOT NULL,
        reference_external_transaction_id text,
        reference_transaction_id uuid REFERENCES wager_transactions(id),
        status text NOT NULL,
        failure_code text,
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE wager_transactions ADD CONSTRAINT uq_tx_provider_idempotency
        UNIQUE (provider_id, idempotency_key)
    `);

    await queryRunner.query(`
      ALTER TABLE wager_transactions ADD CONSTRAINT uq_tx_provider_external
        UNIQUE (provider_id, external_transaction_id)
    `);

    await queryRunner.query(`
      ALTER TABLE wager_transactions ADD CONSTRAINT ck_tx_money_positive
        CHECK (money_amount > 0 AND money_amount < 'NaN')
    `);

    await queryRunner.query(`
      ALTER TABLE wager_transactions ADD CONSTRAINT ck_tx_reference_required
        CHECK (kind NOT IN ('REFUND', 'ROLLBACK')
               OR reference_external_transaction_id IS NOT NULL)
    `);

    await queryRunner.query(`
      ALTER TABLE wager_transactions ADD CONSTRAINT ck_tx_failure_code_on_terminal
        CHECK (status NOT IN ('REJECTED', 'FAILED') OR failure_code IS NOT NULL)
    `);

    await queryRunner.query(`
      ALTER TABLE wager_transactions ADD CONSTRAINT ck_tx_reference_resolved_on_processed_reversal
        CHECK (status != 'PROCESSED'
               OR kind NOT IN ('REFUND', 'ROLLBACK')
               OR reference_transaction_id IS NOT NULL)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_reversal_per_reference
        ON wager_transactions (reference_transaction_id, kind)
        WHERE status = 'PROCESSED' AND kind IN ('REFUND', 'ROLLBACK')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE wager_transactions');
  }
}
