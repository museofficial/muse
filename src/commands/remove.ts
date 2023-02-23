import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Songs aus der Warteschlange entfernen')
    .addIntegerOption(option =>
      option.setName('position')
        .setDescription('Position des zu entfernenden Songs [Standard: 1]')
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option.setName('range')
        .setDescription('Anzahl der zu entfernenden Songs [Standard: 1]')
        .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const position = interaction.options.getInteger('position') ?? 1;
    const range = interaction.options.getInteger('range') ?? 1;

    if (position < 1) {
      throw new Error('die Position muss mindestens 1 sein');
    }

    if (range < 1) {
      throw new Error('der Bereich muss mindestens 1 sein');
    }

    player.removeFromQueue(position, range);

    await interaction.reply(':wastebasket: entfernt');
  }
}
