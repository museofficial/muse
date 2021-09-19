import makeDir from 'make-dir';
import path from 'path';
import container from './inversify.config';
import {TYPES} from './types';
import Bot from './bot';
import {sequelize} from './utils/db';
import Config from './services/config';

const bot = container.get<Bot>(TYPES.Bot);

(async () => {
  // Create data directories if necessary
  const config = container.get<Config>(TYPES.Config);

  await makeDir(config.DATA_DIR);
  await makeDir(config.CACHE_DIR);
  await makeDir(path.join(config.CACHE_DIR, 'tmp'));

  await sequelize.sync({});

  await bot.listen();
})();
