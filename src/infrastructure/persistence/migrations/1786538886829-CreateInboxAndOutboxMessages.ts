import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxAndOutboxMessages1786538886829 implements MigrationInterface {
  name = 'CreateInboxAndOutboxMessages1786538886829';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        consumer_name text NOT NULL,
        message_id text NOT NULL,
        payload_hash text NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        CONSTRAINT pk_inbox PRIMARY KEY (consumer_name, message_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE outbox_messages (
        id uuid PRIMARY KEY,
        aggregate_id uuid NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        attempts int NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        published_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE INDEX ix_outbox_pending
        ON outbox_messages (next_attempt_at NULLS FIRST, occurred_at)
        WHERE published_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox_messages');
    await queryRunner.query('DROP TABLE inbox_messages');
  }
}
