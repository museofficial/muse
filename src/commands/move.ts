import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import formatSongReply from '../utils/format-song-reply.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('move')
    .addIntegerOption(option =>
      option.setName('from')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option.setName('to')
        .setRequired(true)));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const from = interaction.options.getInteger('from') ?? 1;
    const to = interaction.options.getInteger('to') ?? 1;

    if (from < 1) {
      throw new LocalizedError('error.positionTooLow');
    }

    if (to < 1) {
      throw new LocalizedError('error.positionTooLow');
    }

    const {title} = player.move(from, to);

    await interaction.reply(formatSongReply(title, shown => t(interaction.locale, 'move.done', {title: shown, position: to})));
  }
}
