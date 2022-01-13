import {Message} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import buildQueueEmbed from '../utils/build-queue-embed.js';

@injectable()
export default class implements Command {
  public name = 'queue';
  public aliases = ['q'];
  public examples = [
    ['queue', 'shows current queue'],
    ['queue 2', 'shows second page of queue'],
  ];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    const embed = buildQueueEmbed(player, args[0] ? parseInt(args[0], 10) : 1);

    await msg.channel.send({embeds: [embed]});
  }
}
