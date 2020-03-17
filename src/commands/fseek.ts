import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import QueueManager from '../managers/queue';
import LoadingMessage from '../utils/loading-message';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'fseek';
  public examples = [
    ['fseek 10', 'skips forward in current song by 10 seconds']
  ];

  private readonly playerManager: PlayerManager;
  private readonly queueManager: QueueManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Managers.Queue) queueManager: QueueManager) {
    this.playerManager = playerManager;
    this.queueManager = queueManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const queue = this.queueManager.get(msg.guild!.id);

    if (queue.get().length === 0) {
      await msg.channel.send('nothing is playing');
      return;
    }

    if (queue.get()[0].isLive) {
      await msg.channel.send('can\'t seek in a livestream');
      return;
    }

    const seekTime = parseInt(args[0], 10);

    const loading = new LoadingMessage(msg.channel as TextChannel, 'hold on a sec');

    await loading.start();

    try {
      await this.playerManager.get(msg.guild!.id).forwardSeek(seekTime);

      await loading.stop('seeked');
    } catch (_) {
      await loading.stop('error somewhere');
    }
  }
}
