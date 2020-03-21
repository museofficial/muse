import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import Command from '.';
import LoadingMessage from '../utils/loading-message';
import errorMsg from '../utils/error-msg';

@injectable()
export default class implements Command {
  public name = 'skip';
  public aliases = ['s'];
  public examples = [
    ['skip', 'skips the current song']
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    const loader = new LoadingMessage(msg.channel as TextChannel);

    try {
      await loader.start();
      await player.forward();

      await loader.stop('keep \'er movin\'');
    } catch (_) {
      await loader.stop(errorMsg('no song to skip to'));
    }
  }
}
