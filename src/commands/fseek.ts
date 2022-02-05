import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
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
      throw new Error('nothing is playing');
    }

    if (currentSong.isLive) {
      throw new Error('can\'t seek in a livestream');
    }

    const seekTime = interaction.options.getNumber('seconds');

    if (!seekTime) {
      throw new Error('missing number of seconds to seek');
    }

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new Error('can\'t seek past the end of the song');
    }

    await Promise.all([
      player.forwardSeek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply(`👍 seeked to ${prettyTime(player.getPosition())}`);
  }
}
