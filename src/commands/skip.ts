import {CommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import errorMsg from '../utils/error-msg.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public name = 'skip';
  public aliases = ['s'];
  public examples = [
    ['skip', 'skips the current song'],
    ['skip 2', 'skips the next 2 songs'],
  ];

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('skip')
    .setDescription('skips the next songs')
    .addIntegerOption(option => option
      .setName('number')
      .setDescription('number of songs to skip [default: 1]')
      .setRequired(false));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction): Promise<void> {
    const numToSkip = interaction.options.getInteger('skip') ?? 1;

    if (numToSkip < 1) {
      await interaction.reply({content: errorMsg('invalid number of songs to skip'), ephemeral: true});
    }

    const player = this.playerManager.get(interaction.guild!.id);

    try {
      await player.forward(numToSkip);
      await interaction.reply('keep \'er movin\'');
    } catch (_: unknown) {
      await interaction.reply({content: errorMsg('invalid number of songs to skip'), ephemeral: true});
    }
  }
}
