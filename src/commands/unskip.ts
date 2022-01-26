import {CommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('unskip')
    .setDescription('goes back in the queue by one song');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    try {
      await player.back();
      await interaction.reply({
        content: 'back \'er up\'',
        embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
      });
    } catch (_: unknown) {
      await interaction.reply({
        content: errorMsg('no song to go back to'),
        ephemeral: true,
      });
    }
  }
}
