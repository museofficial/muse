import {DATA_DIR} from '../services/config.js';
import createDatabaseUrl from '../utils/create-database-url.js';
import {execa} from 'execa';

(async () => {
  await execa(process.argv[2], process.argv.slice(3), {
    preferLocal: true,
    stderr: process.stderr,
    stdout: process.stdout,
    stdin: process.stdin,
    env: {
      DATABASE_URL: createDatabaseUrl(DATA_DIR),
    },
  });
})();
