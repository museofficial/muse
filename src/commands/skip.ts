import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import LoadingMessage from '../utils/loading-message.js';
import errorMsg from '../utils/error-msg.js';
import buildQueueEmbed from '../utils/build-queue-embed.js';

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

    const loader = new LoadingMessage(msg.channel as TextChannel);

    try {
      await loader.start();
      await player.forward(numToSkip);
    } catch (_: unknown) {
      await loader.stop(errorMsg('no song to skip to'));
      return;
    }

    const promises = [
      loader.stop('keep \'er movin\''),
    ];

    if (player.getCurrent()) {
      promises.push(msg.channel.send({
        embeds: [buildQueueEmbed(player, 1, true)],
      }));
    }

    await Promise.all(promises);
  }
}
