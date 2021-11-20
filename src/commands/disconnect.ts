import {Message} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'disconnect';
  public aliases = ['dc'];
  public examples = [
    ['disconnect', 'pauses and disconnects player'],
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    if (!player.voiceConnection) {
      await msg.channel.send(errorMsg('I\'m not connected to any voice channel.'));
      return;
    }

    player.disconnect();
  }
}
