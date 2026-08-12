import { AppDataSource } from '@infrastructure/persistence/data-source.ts';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const executed = await AppDataSource.runMigrations();
  await AppDataSource.destroy();

  for (const migration of executed) {
    console.log(`aplicada: ${migration.name}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
