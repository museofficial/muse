import {inject, injectable} from 'inversify';
import {Client} from 'discord.js';
import {TYPES} from '../types.js';
import Player from '../services/player.js';
import FileCacheProvider from '../services/file-cache.js';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly discordClient: Client;
  private readonly fileCache: FileCacheProvider;

  constructor(@inject(TYPES.FileCache) fileCache: FileCacheProvider, @inject(TYPES.Client) client: Client) {
    this.guildPlayers = new Map();
    this.discordClient = client;
    this.fileCache = fileCache;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.discordClient, this.fileCache, guildId);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
