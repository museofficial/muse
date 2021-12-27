import {CommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import errorMsg from '../utils/error-msg.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('remove')
    .setDescription('remove songs from the queue')
    .addIntegerOption(option =>
      option.setName('position')
        .setDescription('position of the song to remove [default: 1]')
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option.setName('range')
        .setDescription('number of songs to remove [default: 1]')
        .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executeFromInteraction(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const position = interaction.options.getInteger('position') ?? 1;
    const range = interaction.options.getInteger('range') ?? 1;

    if (position < 1) {
      await interaction.reply({
        content: errorMsg('position must be greater than 0'),
        ephemeral: true,
      });
    }

    if (range < 1) {
      await interaction.reply({
        content: errorMsg('range must be greater than 0'),
        ephemeral: true,
      });
    }

    player.removeFromQueue(position, range);

    await interaction.reply(':wastebasket: removed');
  }
}
