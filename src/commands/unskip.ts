import { SlashCommandBuilder } from '@discordjs/builders';
import { ChatInputCommandInteraction } from 'discord.js';
import { inject, injectable } from 'inversify';
import PlayerManager from '../managers/player.js';
import { TYPES } from '../types.js';
import { buildPlayingMessageEmbed } from '../utils/build-embed.js';
import Command from './index.js';

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

    try {
      await player.back();
      await interaction.reply({
        content: 'back \'er up\'',
        embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
      });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_: unknown) {
      throw new Error('no song to go back to');
    }
  }
}
