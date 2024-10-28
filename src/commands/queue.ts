import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {buildQueueEmbed} from '../utils/build-embed.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('show the current queue')
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('page of queue to show [default: 1]')
      .setRequired(false))
    .addIntegerOption(option => option
      .setName('page-size')
      .setDescription('how many items to display per page [default: 10, max: 30]')
      .setMinValue(1)
      .setMaxValue(30)
      .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);

    const pageSizeFromOptions = interaction.options.getInteger('page-size');
    const pageSize = pageSizeFromOptions ?? (await getGuildSettings(guildId)).defaultQueuePageSize;

    const embed = buildQueueEmbed(
      player,
      interaction.options.getInteger('page') ?? 1,
      pageSize,
    );

    await interaction.reply({embeds: [embed]});
  }
}
