import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {buildQueueEmbed} from '../utils/build-embed.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('queue')
    .addIntegerOption(option => option
      .setName('page')
      .setMinValue(1)
      .setRequired(false))
    .addIntegerOption(option => option
      .setName('page-size')
      .setMinValue(1)
      .setMaxValue(30)
      .setRequired(false)));

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
      interaction.locale,
    );

    await interaction.reply({embeds: [embed], ephemeral: true});
  }
}
