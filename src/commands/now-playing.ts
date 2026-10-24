import {ChatInputCommandInteraction, GuildTextBasedChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import SessionPlayer from '../services/session-player.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('now-playing')
    .setDescription('shows the currently played song');

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Services.SessionPlayer) private readonly sessionPlayer: SessionPlayer) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.listeningSession?.snapshot()) {
      throw new Error('nothing is currently playing');
    }

    await interaction.deferReply({ephemeral: true});
    const url = await this.sessionPlayer.ensureMessage(player, interaction.channel as GuildTextBasedChannel);
    await interaction.editReply({content: `[Go to player](${url})`, allowedMentions: {parse: []}});
  }
}
