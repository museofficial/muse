import {inject, injectable} from 'inversify';
import {TYPES} from '../types';
import Player from '../services/player';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly cacheDir: string;

  constructor(@inject(TYPES.Config.CACHE_DIR) cacheDir: string) {
    this.guildPlayers = new Map();
    this.cacheDir = cacheDir;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.cacheDir);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
