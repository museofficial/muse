import {CommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {SlashCommandBuilder} from '@discordjs/builders';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import { STATUS } from '../services/player.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('now-playing')
    .setDescription('Zeigt an was gespielt wird.');

  public requiresVC = false;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.voiceConnection == null) {
      throw new Error('Geh wem anders auf die Nerven, ich bin nicht anwesend!');
    } else {
      if (player.status == STATUS.PLAYING || player.status == STATUS.PAUSED) {
        await interaction.reply({
          content: 'Das hier wird gerade gespielt:',
          embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
        });
      } else if (player.status == STATUS.IDLE) {
        await interaction.reply('Gib mir erstmal Arbeit bevor du das machst!')
      }
    }

  }
}
