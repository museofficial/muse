import {CommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';
import {parseTime, prettyTime} from '../utils/time.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('seek')
    .setDescription('seek to a position from beginning of song')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('time to seek')
        .setRequired(true),
    );

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

    const time = interaction.options.getString('time')!;

    let seekTime = 0;

    if (time.includes(':')) {
      seekTime = parseTime(time);
    } else {
      seekTime = parseInt(time, 10);
    }

    if (seekTime > currentSong.length) {
      await interaction.reply({
        content: errorMsg('can\'t seek past the end of the song'),
        ephemeral: true,
      });
      return;
    }

    await Promise.all([
      player.seek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply(`👍 seeked to ${prettyTime(player.getPosition())}`);
  }
}
