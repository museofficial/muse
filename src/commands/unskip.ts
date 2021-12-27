import {CommandInteraction, Message} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('unskip')
    .setDescription('goes back in the queue by one song');

  public name = 'unskip';
  public aliases = ['back'];
  public examples = [
    ['unskip', 'goes back in the queue by one song'],
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executeFromInteraction(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    try {
      await player.back();

      await interaction.reply('back \'er up\'');
    } catch (_: unknown) {
      await interaction.reply({
        content: errorMsg('no song to go back to'),
        ephemeral: true,
      });
    }
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    try {
      await player.back();

      await msg.channel.send('back \'er up\'');
    } catch (_: unknown) {
      await msg.channel.send(errorMsg('no song to go back to'));
    }
  }
}
