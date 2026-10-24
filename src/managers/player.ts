import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Player from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';
import type YoutubeAPI from '../services/youtube-api.js';
import Config from '../services/config.js';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;
  private readonly youtubeAPI: YoutubeAPI;
  private readonly config: Config;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider,
    @inject(TYPES.Services.YoutubeAPI) youtubeAPI: YoutubeAPI,
    @inject(TYPES.Config) config: Config) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
    this.youtubeAPI = youtubeAPI;
    this.config = config;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(
        this.fileCache,
        guildId,
        async song => this.youtubeAPI.findAudioFallback(song),
        this.config.PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS,
      );

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }

  /**
   * Returns a player only when the guild already has one. Reaction events use
   * this to avoid allocating idle players for unrelated Discord messages.
   */
  getExisting(guildId: string): Player | undefined {
    return this.guildPlayers.get(guildId);
  }
}
