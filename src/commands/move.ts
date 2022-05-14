import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('move')
    .setDescription('move songs within the queue')
    .addIntegerOption(option =>
      option.setName('from')
        .setDescription('position of the song to move')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option.setName('to')
        .setDescription('position to move the song to')
        .setRequired(true));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const from = interaction.options.getInteger('from') ?? 1;
    const to = interaction.options.getInteger('to') ?? 1;

    if (from < 1) {
      throw new Error('position must be at least 1');
    }

    if (to < 1) {
      throw new Error('position must be at least 1');
    }

    const {title} = player.move(from, to);

    await interaction.reply('moved **' + title + '** to position **' + String(to) + '**');
  }
}
