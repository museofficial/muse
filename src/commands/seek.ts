import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import Player from '../services/player';
import LoadingMessage from '../utils/loading-message';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'seek';
  public description = 'seeks position in currently playing song';
  private readonly player: Player;

  constructor(@inject(TYPES.Services.Player) player: Player) {
    this.player = player;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const seekTime = parseInt(args[0], 10);

    const loading = new LoadingMessage(msg.channel as TextChannel, 'hold on a sec');

    await loading.start();

    try {
      await this.player.seek(msg.guild!.id, seekTime);

      await loading.stop('seeked');
    } catch (_) {
      await loading.stop('error somewhere');
    }
  }
}
