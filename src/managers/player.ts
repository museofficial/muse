import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Player from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';
import Config from '../services/config.js';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;
  private readonly config: Config;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider, @inject(TYPES.Config) config: Config) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
    this.config = config;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.fileCache, guildId, this.config);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
