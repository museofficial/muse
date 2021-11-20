import {Message, TextChannel} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import LoadingMessage from '../utils/loading-message.js';
import errorMsg from '../utils/error-msg.js';

@injectable()
export default class implements Command {
  public name = 'remove';
  public aliases = ['rm'];
  public examples = [
    ['remove 1', 'removes the first song in the queue (not the one thats playing, just skip it dummy)'],
    ['rm 6-9', 'removes the every song in range [6-9] from the queue'],
  ];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    const res = new LoadingMessage(msg.channel as TextChannel);
    await res.start();

    if (args.length === 0) {
      await res.stop('atleast give me a clue for which song you want to remove');
      return;
    }

    const reg = /^(\d+)-(\d+)$|^(\d+)$/g; // Expression has 3 groups: x-y or z. x-y is range, z is a single digit.
    const match = reg.exec(args[0]);

    if (match === null) {
      await res.stop(errorMsg('incorrect format, just an index or start-end format'));
      return;
    }

    if (match[3] === undefined) { // 3rd group (z) doesn't exist -> a range
      const range = [parseInt(match[1], 10), parseInt(match[2], 10)];

      if (range[0] < 1) {
        await res.stop(errorMsg('you start counting with 1'));
        return;
      }

      if (range[1] > player.queueSize()) {
        await res.stop(errorMsg('queue isn\'t THAT big'));
        return;
      }

      if (range[0] < range[1]) {
        player.removeFromQueue(range[0], range[1] - range[0] + 1);
      } else {
        await res.stop(errorMsg('range is backwards, just like you'));
        return;
      }

      console.log(range);
    } else { // 3rd group exists -> just one song
      const index = parseInt(match[3], 10);

      if (index < 1) {
        await res.stop(errorMsg('it\'s got be bigger than 0, chief'));
        return;
      }

      if (index > player.queueSize()) {
        await res.stop(errorMsg('queue isn\'t THAT big'));
        return;
      }

      player.removeFromQueue(index, 1);
    }

    await res.stop('to the trash it goes :wastebasket:');
  }
}
