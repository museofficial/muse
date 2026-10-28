import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {prettyTime} from '../utils/time.js';
import durationStringToSeconds from '../utils/duration-string-to-seconds.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('fseek')
    .addStringOption(option => option
      .setName('time')
      .setRequired(true)));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new LocalizedError('error.nothingPlaying');
    }

    if (currentSong.isLive) {
      throw new LocalizedError('seek.error.livestream');
    }

    const seekValue = interaction.options.getString('time');

    if (!seekValue) {
      throw new LocalizedError('seek.error.missingValue');
    }

    const seekTime = durationStringToSeconds(seekValue);

    if (!Number.isFinite(seekTime) || seekTime <= 0) {
      throw new LocalizedError('seek.error.invalidValue');
    }

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new LocalizedError('seek.error.pastEnd');
    }

    await Promise.all([
      player.forwardSeek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply(t(interaction.locale, 'seek.done', {position: prettyTime(player.getPosition())}));
  }
}
