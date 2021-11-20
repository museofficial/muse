import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import errorMsg from '../utils/error-msg.js';

@injectable()
export default class implements Command {
  public name = 'skip';
  public aliases = ['s'];
  public examples = [
    ['skip', 'skips the current song'],
    ['skip 2', 'skips the next 2 songs'],
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    let numToSkip = 1;

    if (args.length === 1) {
      if (!Number.isNaN(parseInt(args[0], 10))) {
        numToSkip = parseInt(args[0], 10);
      }
    }

    const player = this.playerManager.get(msg.guild!.id);

    try {
      await player.forward(numToSkip);
    } catch (_: unknown) {
      await msg.channel.send(errorMsg('There are no song to skip forward to.'));
    }
  }
}
