import {Message} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'shuffle';
  public aliases = [];
  public examples = [
    ['shuffle', 'shuffles the current queue'],
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    if (player.isQueueEmpty()) {
      await msg.channel.send(errorMsg('I can\'t shuffle an empty song queue.'));
      return;
    }

    player.shuffle();

    await msg.channel.send('I\'ve shuffled the song queue.');
  }
}
