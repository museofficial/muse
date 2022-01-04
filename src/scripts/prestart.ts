// This script applies Prisma migrations
// and then calls the entry point in src/index.ts.
import dotenv from 'dotenv';
dotenv.config();

import {execa, ExecaError} from 'execa';
import Prisma from '@prisma/client';
import ora from 'ora';
import {startBot} from './start.js';
import {DATA_DIR} from '../services/config.js';
import createDatabaseUrl from '../utils/create-database-url.js';
import logBanner from '../utils/log-banner.js';

process.env.DATABASE_URL = createDatabaseUrl(DATA_DIR);

const migrateFromSequelizeToPrisma = async () => {
  await execa('prisma', ['migrate', 'resolve', '--applied', '20220101155430_migrate_from_sequelize'], {preferLocal: true});
};

(async () => {
  // Banner
  logBanner();

  const client = new Prisma.PrismaClient();

  const spinner = ora('Applying database migrations...').start();

  try {
    await client.$queryRaw`SELECT COUNT(id) FROM _prisma_migrations`;
  } catch (error: unknown) {
    if (error instanceof Prisma.Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
      try {
        await migrateFromSequelizeToPrisma();
      } catch (error: unknown) {
        if ((error as ExecaError).stderr) {
          spinner.fail('Failed to apply database migrations (going from Sequelize to Prisma):');
          console.error((error as ExecaError).stderr);
          process.exit(1);
        } else {
          throw error;
        }
      }
    } else {
      throw error;
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
