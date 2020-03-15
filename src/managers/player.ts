import {inject, injectable} from 'inversify';
import {TYPES} from '../types';
import Player from '../services/player';
import QueueManager from './queue';

@injectable()
export default class {
  private readonly guildPlayers: Map<string, Player>;
  private readonly cacheDir: string;
  private readonly queueManager: QueueManager;

  constructor(@inject(TYPES.Config.CACHE_DIR) cacheDir: string, @inject(TYPES.Managers.Queue) queueManager: QueueManager) {
    this.guildPlayers = new Map();
    this.cacheDir = cacheDir;
    this.queueManager = queueManager;
  }

  get(guildId: string): Player {
    let player = this.guildPlayers.get(guildId);

    if (!player) {
      player = new Player(this.queueManager.get(guildId), this.cacheDir);

      this.guildPlayers.set(guildId, player);
    }

    return player;
  }
}
