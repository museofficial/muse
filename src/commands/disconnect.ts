import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('pauses and disconnects player');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executeFromInteraction(interaction: CommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.voiceConnection) {
      await interaction.reply({
        content: errorMsg('not connected'),
        ephemeral: true,
      });

      return;
    }

    player.disconnect();

    await interaction.reply('u betcha');
  }
}
