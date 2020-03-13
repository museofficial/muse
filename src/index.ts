import container from './inversify.config';
import Spotify from 'spotify-web-api-node';
import {TYPES} from './types';
import Bot from './bot';

let bot = container.get<Bot>(TYPES.Bot);
const spotify = container.get<Spotify>(TYPES.Lib.Spotify);

(async () => {
  const auth = await spotify.clientCredentialsGrant();

  spotify.setAccessToken(auth.body.access_token);

  bot.listen();
})();
