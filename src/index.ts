import {DATA_DIR} from './services/config.js';
import {startBot} from './scripts/start.js';
import createDatabaseUrl from './utils/create-database-url.js';
import logBanner from './utils/log-banner.js';

process.env.DATABASE_URL = createDatabaseUrl(DATA_DIR);

(async () => {
  logBanner();
  await startBot();
})();
