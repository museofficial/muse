import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {buildQueueEmbed} from '../utils/build-embed.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Zeigt die aktuelle Wiedergabeliste.')
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('Anzuzeigende Seite der Liste [Standard: 1]')
      .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    const embed = buildQueueEmbed(player, interaction.options.getInteger('page') ?? 1);

    await interaction.reply({embeds: [embed]});
  }
}
