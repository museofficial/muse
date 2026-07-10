import {inject, injectable} from 'inversify';
import {Client} from 'discord.js';
import {TYPES} from '../types.js';
import Player from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly fileCache: FileCacheProvider;
  private readonly client: Client;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider, @inject(TYPES.Client) client: Client) {
    this.guildPlayers = new Map();
    this.fileCache = fileCache;
    this.client = client;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.fileCache, guildId, this.client);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
