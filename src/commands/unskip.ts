import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('unskip'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    await interaction.deferReply({ephemeral: true});

    try {
      await player.back();
      await interaction.followUp({
        content: t(interaction.locale, 'unskip.done'),
        embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player, interaction.locale)] : [],
      });
      await interaction.deleteReply().catch(() => undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to go back to.') {
        throw new LocalizedError('error.noSongToGoBackTo');
      }

      throw error;
    }
  }
}
