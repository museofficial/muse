import {inject, injectable} from 'inversify';
import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Löscht alle Songs in der Queue bis auf den aktuellen.');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction) {
    this.playerManager.get(interaction.guild!.id).clear();

    await interaction.reply('Sauberer als bei dir zuhause.');
  }
}
