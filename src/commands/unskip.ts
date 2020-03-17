import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import QueueManager from '../managers/queue';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'unskip';
  public examples = [
    ['unskip', 'goes back in the queue by one song']
  ];

  private readonly queueManager: QueueManager;
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Queue) queueManager: QueueManager, @inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.queueManager = queueManager;
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const queue = this.queueManager.get(msg.guild!.id);

    try {
      queue.back();

      await this.playerManager.get(msg.guild!.id).play();

      await msg.channel.send('back \'er up\'');
    } catch (_) {
      await msg.channel.send('no song to go back to');
    }
  }
}
