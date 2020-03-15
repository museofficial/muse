import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import LoadingMessage from '../utils/loading-message';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'seek';
  public description = 'seeks position in currently playing song';
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const time = args[0];

    let seekTime = 0;

    if (time.includes(':')) {
      seekTime = (parseInt(time.split(':')[0], 10) * 60) + parseInt(time.split(':')[1], 10);
    } else {
      seekTime = parseInt(time, 10);
    }

    const loading = new LoadingMessage(msg.channel as TextChannel, 'hold on a sec');

    await loading.start();

    try {
      await this.playerManager.get(msg.guild!.id).seek(seekTime);

      await loading.stop('seeked');
    } catch (_) {
      await loading.stop('error somewhere');
    }
  }
}
