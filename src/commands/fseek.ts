import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {prettyTime} from '../utils/time.js';
import durationStringToSeconds from '../utils/duration-string-to-seconds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('fseek')
    .setDescription('im laufenden Song vorspulen')
    .addStringOption(option => option
      .setName('time')
      .setDescription('ein Intervall oder eine Anzahl von Sekunden (1m, 30s, 100)')
      .setRequired(true));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('es wird nichts abgespielt');
    }

    if (currentSong.isLive) {
      throw new Error('ich kann in einem Livestream nicht vorspulen');
    }

    const seekValue = interaction.options.getString('time');

    if (!seekValue) {
      throw new Error('fehlender Suchwert');
    }

    const seekTime = durationStringToSeconds(seekValue);

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new Error('ich kann nicht über das Ende des Liedes hinaus spulen');
    }

    await Promise.all([
      player.forwardSeek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply(`👍 nach ${prettyTime(player.getPosition())} gespult`);
  }
}
