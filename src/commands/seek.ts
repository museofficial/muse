import {CommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import {parseTime, prettyTime} from '../utils/time.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import durationStringToSeconds from '../utils/duration-string-to-seconds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Springt zu einer Position nach hinten vom jetzigen Zeitpunkt.')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Ein Zeitraum in Sekunden (1m, 30s, 100)')
        .setRequired(true),
    );

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('Gib mir erstmal Arbeit bevor du das machst!');
    }

    if (currentSong.isLive) {
      throw new Error('Dass das live ist weißt du schon, ne?');
    }

    const time = interaction.options.getString('time')!;

    let seekTime = 0;

    if (time.includes(':')) {
      seekTime = parseTime(time);
    } else {
      seekTime = durationStringToSeconds(time);
    }

    if (seekTime > currentSong.length) {
      throw new Error('Ey, so weit kann ich nicht gehen! Da ist der Song schon zuende!');
    }

    await Promise.all([
      player.seek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply(`👍 Wir sind bei ${prettyTime(player.getPosition())} angekommen, zufrieden?`);
  }
}
