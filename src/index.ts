import Spotify from 'spotify-web-api-node';
import makeDir from 'make-dir';
import path from 'path';
import container from './inversify.config';
import {TYPES} from './types';
import Bot from './bot';
import {sequelize} from './utils/db';

let bot = container.get<Bot>(TYPES.Bot);
const spotify = container.get<Spotify>(TYPES.Lib.Spotify);

(async () => {
  const auth = await spotify.clientCredentialsGrant();

  spotify.setAccessToken(auth.body.access_token);

  // Create data directories if necessary
  await makeDir(container.get(TYPES.Config.DATA_DIR));
  await makeDir(container.get(TYPES.Config.CACHE_DIR));
  await makeDir(path.join(container.get(TYPES.Config.CACHE_DIR), 'tmp'));

  await sequelize.sync({});

  await bot.listen();
})();
