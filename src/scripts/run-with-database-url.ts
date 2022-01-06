import {DATA_DIR} from '../services/config.js';
import createDatabaseUrl from '../utils/create-database-url.js';
import {execa} from 'execa';

process.env.DATABASE_URL = createDatabaseUrl(DATA_DIR);

(async () => {
  await execa(process.argv[2], process.argv.slice(3), {
    preferLocal: true,
    stderr: process.stderr,
    stdout: process.stdout,
  });
})();
