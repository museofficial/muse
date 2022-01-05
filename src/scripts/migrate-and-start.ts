// This script applies Prisma migrations
// and then starts Muse.
import dotenv from 'dotenv';
dotenv.config();

import {execa, ExecaError} from 'execa';
import {promises as fs} from 'fs';
import Prisma from '@prisma/client';
import ora from 'ora';
import {startBot} from '../index.js';
import logBanner from '../utils/log-banner.js';
import {createDatabasePath} from '../utils/create-database-url.js';
import {DATA_DIR} from '../services/config.js';

const client = new Prisma.PrismaClient();

const migrateFromSequelizeToPrisma = async () => {
  await execa('prisma', ['migrate', 'resolve', '--applied', '20220101155430_migrate_from_sequelize'], {preferLocal: true});
};

const doesUserHaveExistingDatabase = async () => {
  try {
    await fs.access(createDatabasePath(DATA_DIR));

    return true;
  } catch {
    return false;
  }
};

const hasDatabaseBeenMigratedToPrisma = async () => {
  try {
    await client.$queryRaw`SELECT COUNT(id) FROM _prisma_migrations`;
  } catch (error: unknown) {
    if (error instanceof Prisma.Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
      // Table doesn't exist
      return false;
    }

    throw error;
  }

  return true;
};

(async () => {
  // Banner
  logBanner();

  const spinner = ora('Applying database migrations...').start();

  if (await doesUserHaveExistingDatabase()) {
    if (!(await hasDatabaseBeenMigratedToPrisma())) {
      try {
        await migrateFromSequelizeToPrisma();
      } catch (error) {
        if ((error as ExecaError).stderr) {
          spinner.fail('Failed to apply database migrations (going from Sequelize to Prisma):');
          console.error((error as ExecaError).stderr);
          process.exit(1);
        } else {
          throw error;
        }
      }
    }
  }

  try {
    await execa('prisma', ['migrate', 'deploy'], {preferLocal: true});
  } catch (error: unknown) {
    if ((error as ExecaError).stderr) {
      spinner.fail('Failed to apply database migrations:');
      console.error((error as ExecaError).stderr);
      process.exit(1);
    } else {
      throw error;
    }
  }

  spinner.succeed('Database migrations applied.');

  await startBot();
})();
