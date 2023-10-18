import createDatabaseUrl from '../utils/create-database-url.js';
import {DATA_DIR} from '../services/config.js';

console.log(createDatabaseUrl(DATA_DIR));
