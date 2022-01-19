import ora from 'ora';
import {prisma} from '../utils/db.js';

(async () => {
  const spinner = ora('Clearing key value cache...').start();

  await prisma.keyValueCache.deleteMany({});

  spinner.succeed('Key value cache cleared.');
})();
