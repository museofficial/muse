import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import QueueManager from '../managers/queue';
import LoadingMessage from '../utils/loading-message';
import errorMsg from '../utils/error-msg';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'seek';
  public examples = [
    ['seek 10', 'seeks to 10 seconds from begining of song'],
    ['seek 1:30', 'seeks to 1 minute and 30 seconds from begining of song']
  ];

  private readonly playerManager: PlayerManager;
  private readonly queueManager: QueueManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Managers.Queue) queueManager: QueueManager) {
    this.playerManager = playerManager;
    this.queueManager = queueManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const queue = this.queueManager.get(msg.guild!.id);

    const currentSong = queue.getCurrent();

    if (!currentSong) {
      await msg.channel.send(errorMsg('nothing is playing'));
      return;
    }

    if (currentSong.isLive) {
      await msg.channel.send(errorMsg('can\'t seek in a livestream'));
      return;
    }

    const time = args[0];

    let seekTime = 0;

    if (time.includes(':')) {
      seekTime = (parseInt(time.split(':')[0], 10) * 60) + parseInt(time.split(':')[1], 10);
    } else {
      seekTime = parseInt(time, 10);
    }

    if (seekTime > currentSong.length) {
      await msg.channel.send(errorMsg('can\'t seek past the end of the song'));
      return;
    }

    const loading = new LoadingMessage(msg.channel as TextChannel);

    await loading.start();

    try {
      await this.playerManager.get(msg.guild!.id).seek(seekTime);

      await loading.stop();
    } catch (error) {
      await loading.stop(errorMsg(error));
    }
  }
}
