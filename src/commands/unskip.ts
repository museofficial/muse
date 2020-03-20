import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import QueueManager from '../managers/queue';
import errorMsg from '../utils/error-msg';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'unskip';
  public aliases = ['back'];
  public examples = [
    ['unskip', 'goes back in the queue by one song']
  ];

  public requiresVC = true;

  private readonly queueManager: QueueManager;
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Queue) queueManager: QueueManager, @inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.queueManager = queueManager;
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const queue = this.queueManager.get(msg.guild!.id);
    const player = this.playerManager.get(msg.guild!.id);

    try {
      queue.back();
      player.resetPosition();

      await msg.channel.send('back \'er up\'');
    } catch (_) {
      await msg.channel.send(errorMsg('no song to go back to'));
    }
  }
}
