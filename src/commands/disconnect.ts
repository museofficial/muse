import {CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Beleidigt den Bot auf das übelste.');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.voiceConnection) {
      throw new Error('Geh wem anders auf die Nerven, ich bin nicht anwesend!');
    }

    player.disconnect();

    await interaction.reply('Danke für\'s disconnecten! Wir sehen uns bei der nächsten Party. Hier ein :cookie: für dich! :slight_smile:');
  }
}
