import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';
import {prettyTime} from '../utils/time.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('fseek')
    .setDescription('seek forward in the current song')
    .addNumberOption(option => option
      .setName('seconds')
      .setDescription('the number of seconds to skip forward')
      .setRequired(true));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      await interaction.reply({
        content: errorMsg('nothing is playing'),
        ephemeral: true,
      });

      return;
    }

    if (currentSong.isLive) {
      await interaction.reply({
        content: errorMsg('can\'t seek in a livestream'),
        ephemeral: true,
      });

      return;
    }

    const seekTime = interaction.options.getNumber('seconds');

    if (!seekTime) {
      await interaction.reply({
        content: errorMsg('missing number of seconds to seek'),
        ephemeral: true,
      });

      return;
    }

    if (seekTime + player.getPosition() > currentSong.length) {
      await interaction.reply({
        content: errorMsg('can\'t seek past the end of the song'),
        ephemeral: true,
      });

      return;
    }

    await Promise.all([
      player.forwardSeek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply(`👍 seeked to ${prettyTime(player.getPosition())}`);
  }
}
