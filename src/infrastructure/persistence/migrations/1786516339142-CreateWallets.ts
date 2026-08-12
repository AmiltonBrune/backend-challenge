import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWallets1786516339142 implements MigrationInterface {
  name = 'CreateWallets1786516339142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wallets (
        id uuid PRIMARY KEY,
        player_id uuid NOT NULL,
        currency char(3) NOT NULL,
        balance_amount numeric(19,2) NOT NULL,
        version int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE wallets ADD CONSTRAINT uq_wallet_player_currency
        UNIQUE (player_id, currency)
    `);

    await queryRunner.query(`
      ALTER TABLE wallets ADD CONSTRAINT ck_wallet_balance_non_negative
        CHECK (balance_amount >= 0 AND balance_amount < 'NaN')
    `);

    await queryRunner.query(`
      ALTER TABLE wallets ADD CONSTRAINT ck_wallet_version_positive
        CHECK (version >= 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE wallets');
  }
}
