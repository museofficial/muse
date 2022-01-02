import makeDir from 'make-dir';
import path from 'path';
import {makeLines} from 'nodesplash';
import container from './inversify.config.js';
import {TYPES} from './types.js';
import Bot from './bot.js';
import Config from './services/config.js';
import FileCacheProvider from './services/file-cache.js';
import metadata from '../package.json';

const bot = container.get<Bot>(TYPES.Bot);

(async () => {
  // Banner
  console.log(makeLines({
    user: 'codetheweb',
    repository: 'muse',
    version: metadata.version,
    paypalUser: 'codetheweb',
    githubSponsor: 'codetheweb',
    madeByPrefix: 'Made with 🎶 by ',
  }).join('\n'));
  console.log('\n');

  // Create data directories if necessary
  const config = container.get<Config>(TYPES.Config);

  await makeDir(config.DATA_DIR);
  await makeDir(config.CACHE_DIR);
  await makeDir(path.join(config.CACHE_DIR, 'tmp'));

  await container.get<FileCacheProvider>(TYPES.FileCache).cleanup();

  await bot.listen();
})();
