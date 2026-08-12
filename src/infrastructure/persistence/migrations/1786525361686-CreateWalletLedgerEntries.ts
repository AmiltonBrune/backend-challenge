import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWalletLedgerEntries1786525361686 implements MigrationInterface {
  name = 'CreateWalletLedgerEntries1786525361686';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wallet_ledger_entries (
        id uuid PRIMARY KEY,
        wallet_id uuid NOT NULL REFERENCES wallets(id),
        transaction_id uuid NOT NULL REFERENCES wager_transactions(id),
        direction text NOT NULL,
        money_amount numeric(19,2) NOT NULL,
        balance_before_amount numeric(19,2) NOT NULL,
        balance_after_amount numeric(19,2) NOT NULL,
        currency char(3) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE wallet_ledger_entries ADD CONSTRAINT uq_ledger_tx_wallet
        UNIQUE (transaction_id, wallet_id)
    `);

    await queryRunner.query(`
      ALTER TABLE wallet_ledger_entries ADD CONSTRAINT ck_ledger_money_positive
        CHECK (money_amount > 0 AND money_amount < 'NaN')
    `);

    await queryRunner.query(`
      ALTER TABLE wallet_ledger_entries ADD CONSTRAINT ck_ledger_balance_non_negative
        CHECK (
          balance_after_amount >= 0 AND balance_after_amount < 'NaN'
          AND balance_before_amount >= 0 AND balance_before_amount < 'NaN'
        )
    `);

    await queryRunner.query(`
      ALTER TABLE wallet_ledger_entries ADD CONSTRAINT ck_ledger_arithmetic
        CHECK (
          (direction = 'CREDIT' AND balance_after_amount = balance_before_amount + money_amount)
          OR
          (direction = 'DEBIT' AND balance_after_amount = balance_before_amount - money_amount)
        )
    `);

    await queryRunner.query(`
      CREATE RULE ledger_no_update AS ON UPDATE TO wallet_ledger_entries DO INSTEAD NOTHING
    `);

    await queryRunner.query(`
      CREATE RULE ledger_no_delete AS ON DELETE TO wallet_ledger_entries DO INSTEAD NOTHING
    `);

    await queryRunner.query(`
      CREATE INDEX ix_ledger_wallet_cursor
        ON wallet_ledger_entries (wallet_id, created_at DESC, id DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE wallet_ledger_entries');
  }
}
