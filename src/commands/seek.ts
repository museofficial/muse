import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';
import {parseTime} from '../utils/time.js';

@injectable()
export default class implements Command {
  public name = 'seek';
  public aliases = [];
  public examples = [
    ['seek 10', 'seeks to 10 seconds from beginning of song'],
    ['seek 1:30', 'seeks to 1 minute and 30 seconds from beginning of song'],
    ['seek 1:00:00', 'seeks to 1 hour from beginning of song'],
  ];

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      await msg.channel.send(errorMsg('I\'m not playing anything at the moment.'));
      return;
    }

    if (currentSong.isLive) {
      await msg.channel.send(errorMsg('I can\'t seek forward in a livestream.'));
      return;
    }

    const time = args[0];

    let seekTime = 0;

    if (time.includes(':')) {
      seekTime = parseTime(time);
    } else {
      seekTime = parseInt(time, 10);
    }

    if (seekTime > currentSong.length) {
      await msg.channel.send(errorMsg('I can\'t seek past the end of the song.'));
      return;
    }

    try {
      await player.seek(seekTime);
    } catch (error: unknown) {
      await msg.channel.send(errorMsg(error as Error));
    }
  }
}
