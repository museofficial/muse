import {CommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('move')
    .setDescription('Verschiebt Songs inmitten der Queue.')
    .addIntegerOption(option =>
      option.setName('from')
        .setDescription('Position des Songs der verschoben werden soll.')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option.setName('to')
        .setDescription('Position wohin der Song geschoben werden soll.')
        .setRequired(true));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const from = interaction.options.getInteger('from') ?? 1;
    const to = interaction.options.getInteger('to') ?? 1;

    if (from < 1) {
      throw new Error('Da ist keiner den ich verschieben kann!');
    }

    if (to < 1) {
      throw new Error('Da kann ich das nicht hinschieben!');
    }

    player.move(from, to);

    await interaction.reply(`${player.queue[{$to}]} wurde zu {$to} verschoben! Zufrieden?`);
  }
}
