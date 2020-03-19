import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import errorMsg from '../utils/error-msg';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'disconnect';
  public aliases = ['dc'];
  public examples = [
    ['disconnect', 'pauses and disconnects player']
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    if (!player.voiceConnection) {
      await msg.channel.send(errorMsg('not connected'));
      return;
    }

    player.disconnect();

    await msg.channel.send('u betcha');
  }
}
