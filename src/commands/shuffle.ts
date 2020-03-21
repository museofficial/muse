import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import errorMsg from '../utils/error-msg';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'shuffle';
  public aliases = [];
  public examples = [
    ['shuffle', 'shuffles the current queue']
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    if (player.isQueueEmpty()) {
      await msg.channel.send(errorMsg('not enough songs to shuffle'));
      return;
    }

    player.shuffle();

    await msg.channel.send('shuffled');
  }
}
