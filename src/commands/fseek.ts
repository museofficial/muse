import {Message, TextChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'fseek';
  public aliases = [];
  public examples = [
    ['fseek 10', 'skips forward in current song by 10 seconds'],
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

    const seekTime = parseInt(args[0], 10);

    if (seekTime + player.getPosition() > currentSong.length) {
      await msg.channel.send(errorMsg('I can\'t seek forward past the end of the song.'));
      return;
    }

    try {
      await player.forwardSeek(seekTime);
    } catch (error: unknown) {
      await msg.channel.send(errorMsg(error as Error));
    }
  }
}
