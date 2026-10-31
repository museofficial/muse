import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('skip')
    .addIntegerOption(option => option
      .setName('number')
      .setRequired(false)));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const numToSkip = interaction.options.getInteger('number') ?? 1;

    if (numToSkip < 1) {
      throw new LocalizedError('skip.error.invalidNumber');
    }

    const player = this.playerManager.get(interaction.guild!.id);
    await interaction.deferReply({ephemeral: true});

    try {
      await player.forward(numToSkip);
      await interaction.editReply(t(interaction.locale, player.getCurrent() ? 'skip.done' : 'skip.queueComplete'));
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to forward to.') {
        throw new LocalizedError('error.noSongToSkipTo');
      }

      throw error;
    }
  }
}
