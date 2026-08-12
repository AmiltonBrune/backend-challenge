import { AppDataSource } from '@infrastructure/persistence/data-source.ts';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  await AppDataSource.undoLastMigration();
  await AppDataSource.destroy();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
