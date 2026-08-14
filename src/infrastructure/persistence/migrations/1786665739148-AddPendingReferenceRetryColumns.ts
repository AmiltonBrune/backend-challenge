import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPendingReferenceRetryColumns1786665739148 implements MigrationInterface {
  name = 'AddPendingReferenceRetryColumns1786665739148';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE wager_transactions
        ADD COLUMN pending_reference_attempts int NOT NULL DEFAULT 0,
        ADD COLUMN pending_reference_next_attempt_at timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX ix_wager_transactions_pending_reference_due
        ON wager_transactions (pending_reference_next_attempt_at NULLS FIRST, created_at)
        WHERE status = 'PENDING_REFERENCE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_wager_transactions_pending_reference_due');
    await queryRunner.query(`
      ALTER TABLE wager_transactions
        DROP COLUMN pending_reference_attempts,
        DROP COLUMN pending_reference_next_attempt_at
    `);
  }
}
