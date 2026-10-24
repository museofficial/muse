import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('unskip')
    .setDescription('go back in the queue by one song');

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
        content: 'back \'er up\'',
        embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
      });
      await interaction.deleteReply().catch(() => undefined);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'No songs in queue to go back to.') {
        throw new Error('no song to go back to');
      }

      throw error;
    }
  }
}
