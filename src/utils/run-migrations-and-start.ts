interface MigrationOrchestration {
  databaseExists: () => Promise<boolean>;
  deployMigrations: () => Promise<void>;
  hasPrismaMigrations: () => Promise<boolean>;
  migrationsApplied?: () => void;
  resolveInitialMigration: () => Promise<void>;
  startBot: () => Promise<void>;
}

export const runMigrationsAndStart = async ({
  databaseExists,
  deployMigrations,
  hasPrismaMigrations,
  migrationsApplied,
  resolveInitialMigration,
  startBot,
}: MigrationOrchestration) => {
  if (await databaseExists() && !(await hasPrismaMigrations())) {
    await resolveInitialMigration();
  }

  await deployMigrations();
  migrationsApplied?.();
  await startBot();
};
