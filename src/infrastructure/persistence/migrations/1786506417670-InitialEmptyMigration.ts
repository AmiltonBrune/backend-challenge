import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialEmptyMigration1786506417670 implements MigrationInterface {
  name = 'InitialEmptyMigration1786506417670';

  public async up(_queryRunner: QueryRunner): Promise<void> {}

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
