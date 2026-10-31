import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('remove')
    .addIntegerOption(option =>
      option.setName('position')
        .setMinValue(1)
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option.setName('range')
        .setMinValue(1)
        .setRequired(false)));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const position = interaction.options.getInteger('position') ?? 1;
    const range = interaction.options.getInteger('range') ?? 1;

    if (position < 1) {
      throw new LocalizedError('error.positionTooLow');
    }

    if (range < 1) {
      throw new LocalizedError('remove.error.rangeTooLow');
    }

    if (position > player.queueSize()) {
      throw new LocalizedError('remove.error.outOfRange');
    }

    player.removeFromQueue(position, range);

    await interaction.reply(t(interaction.locale, 'remove.done'));
  }
}
