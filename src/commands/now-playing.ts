import {ChatInputCommandInteraction, GuildTextBasedChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import SessionPlayer from '../services/session-player.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('now-playing'));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Services.SessionPlayer) private readonly sessionPlayer: SessionPlayer) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.listeningSession?.snapshot()) {
      throw new LocalizedError('error.nothingCurrentlyPlaying');
    }

    await interaction.deferReply({ephemeral: true});
    const url = await this.sessionPlayer.ensureMessage(player, interaction.channel as GuildTextBasedChannel);
    await interaction.editReply({content: t(interaction.locale, 'nowPlaying.goToPlayer', {url}), allowedMentions: {parse: []}});
  }
}
