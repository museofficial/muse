import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {ChatInputCommandInteraction, GuildMember} from 'discord.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('resume')
    .setDescription('resume playback');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);
    if (player.status === STATUS.PLAYING) {
      throw new Error('already playing, give me a song name');
    }

    // Must be resuming play
    if (!player.getCurrent()) {
      throw new Error('nothing to play');
    }

    await player.connect(targetVoiceChannel);
    await player.play();

    await interaction.reply({
      content: 'the stop-and-go light is now green',
      embeds: [buildPlayingMessageEmbed(player)],
    });
  }
}
