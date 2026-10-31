import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('shuffle'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.isQueueEmpty()) {
      throw new LocalizedError('shuffle.error.notEnoughSongs');
    }

    player.shuffle();

    await interaction.reply(t(interaction.locale, 'shuffle.done'));
  }
}
