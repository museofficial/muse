import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildMessageEmbed} from '../utils/build-embed.js';
import messages from '../messages.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('shuffle the current queue');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.isQueueEmpty()) {
      throw new Error(messages.shuffle.notEnoughSongs);
    }

    player.shuffle();

    await interaction.reply({embeds: [buildMessageEmbed(messages.shuffle.success)]});
  }
}
