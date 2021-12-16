import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import UpdatingQueueEmbed from '../services/updating-queue-embed.js';

@injectable()
export default class {
  private readonly embedsByGuild: Map<string, UpdatingQueueEmbed>;
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.embedsByGuild = new Map();
    this.playerManager = playerManager;
  }

  get(guildId: string): UpdatingQueueEmbed {
    let embed = this.embedsByGuild.get(guildId);

    if (!embed) {
      const player = this.playerManager.get(guildId);

      if (!player) {
        throw new Error('Player does not exist for guild.');
      }

      embed = new UpdatingQueueEmbed(player);

      this.embedsByGuild.set(guildId, embed);
    }

    return embed;
  }
}
