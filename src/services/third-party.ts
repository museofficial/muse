import {inject, injectable} from 'inversify';
import SpotifyWebApi from 'spotify-web-api-node';
import pRetry from 'p-retry';
import {TYPES} from '../types.js';
import Config from './config.js';

@injectable()
export default class ThirdParty {
  readonly spotify: SpotifyWebApi;

  private spotifyTokenTimerId?: NodeJS.Timeout;

  constructor(@inject(TYPES.Config) config: Config) {
    this.spotify = new SpotifyWebApi({
      clientId: config.SPOTIFY_CLIENT_ID,
      clientSecret: config.SPOTIFY_CLIENT_SECRET,
    });

    void this.refreshSpotifyToken();
  }

  cleanup() {
    if (this.spotifyTokenTimerId) {
      clearTimeout(this.spotifyTokenTimerId);
    }
  }

  private async refreshSpotifyToken() {
    await pRetry(async () => {
      const auth = await this.spotify.clientCredentialsGrant();
      this.spotify.setAccessToken(auth.body.access_token);
      this.spotifyTokenTimerId = setTimeout(this.refreshSpotifyToken.bind(this), (auth.body.expires_in / 2) * 1000);
    }, {retries: 5});
  }
}
