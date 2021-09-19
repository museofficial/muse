import {inject, injectable} from 'inversify';
import {TYPES} from '../types';
import Player from '../services/player';
import {Client} from 'discord.js';
import Config from '../services/config';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly cacheDir: string;
  private readonly discordClient: Client;

  constructor(@inject(TYPES.Config) config: Config, @inject(TYPES.Client) client: Client) {
    this.guildPlayers = new Map();
    this.cacheDir = config.CACHE_DIR;
    this.discordClient = client;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.cacheDir, this.discordClient);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
