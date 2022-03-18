import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Command from '.';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {CommandInteraction, GuildMember} from 'discord.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Spielt den Song wieder ab.');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  // eslint-disable-next-line complexity
  public async execute(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);
    if (player.status === STATUS.PLAYING) {
      throw new Error('Ruhig, Kumpel! Füg den Song in die Queue ein.');
    }

    // Must be resuming play
    if (!player.getCurrent()) {
      throw new Error('Gib mir erstmal Arbeit bevor du das machst!');
    }

    await player.connect(targetVoiceChannel);
    await player.play();

    await interaction.reply({
      content: 'Okaaaay... let\'s gooo!',
      embeds: [buildPlayingMessageEmbed(player)],
    });
  }
}
