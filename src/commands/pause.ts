import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import Command from '.';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pausiert das aktuelle Lied.');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.status !== STATUS.PLAYING) {
      throw new Error('Lass mich in Ruhe, ich arbeite gerade nicht!');
    }

    player.pause();
    await interaction.reply('Okay... dann halt \'ne Verschnaufspause.');
  }
}
