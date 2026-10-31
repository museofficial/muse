import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import SessionPlayer from '../services/session-player.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {ChatInputCommandInteraction, GuildMember, GuildTextBasedChannel} from 'discord.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('resume'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Services.SessionPlayer) private readonly sessionPlayer: SessionPlayer) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);
    if (player.status === STATUS.PLAYING) {
      throw new LocalizedError('resume.error.alreadyPlaying');
    }

    // Must be resuming play
    if (!player.getCurrent()) {
      throw new LocalizedError('resume.error.nothingToPlay');
    }

    await interaction.deferReply({ephemeral: true});
    if (player.voiceConnection) {
      await player.ensureVoiceConnectionReady();
    } else {
      await player.connect(targetVoiceChannel);
    }

    await player.play();
    if (!player.getCurrent()) {
      throw new LocalizedError('error.noPlayableSongs');
    }

    const url = await this.sessionPlayer.ensureMessage(player, interaction.channel as GuildTextBasedChannel);
    await interaction.editReply({content: t(interaction.locale, 'resume.done', {url}), allowedMentions: {parse: []}});
  }
}
