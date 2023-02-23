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
    .setDescription('verschiebe Songs innerhalb der Warteschlange')
    .addIntegerOption(option =>
      option.setName('from')
        .setDescription('Position des zu verschiebenden Songs')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option.setName('to')
        .setDescription('Position, an die der Song verschoben werden soll')
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
      throw new Error('Position muss mindestens 1 sein');
    }

    if (to < 1) {
      throw new Error('Position muss mindestens 1 sein');
    }

    const {title} = player.move(from, to);

    await interaction.reply('verschiebe **' + title + '** an Position **' + String(to) + '**');
  }
}
