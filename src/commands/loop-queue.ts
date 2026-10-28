import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {STATUS} from '../services/player.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('loop-queue'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.status === STATUS.IDLE) {
      throw new LocalizedError('loopQueue.error.nothingToLoop');
    }

    if (!player.loopCurrentQueue && player.queueSize() < 1) {
      throw new LocalizedError('loopQueue.error.notEnoughSongs');
    }

    if (player.loopCurrentSong) {
      player.loopCurrentSong = false;
    }

    player.loopCurrentQueue = !player.loopCurrentQueue;
    player.refreshPlayingMessage();

    await interaction.reply(t(interaction.locale, player.loopCurrentQueue ? 'loopQueue.on' : 'loopQueue.off'));
  }
}
