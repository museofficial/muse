import {inject, injectable} from 'inversify';
import {Message} from 'discord.js';
import {TYPES} from '../types';
import PlayerManager from '../managers/player';
import QueueManager from '../managers/queue';
import {getMostPopularVoiceChannel} from '../utils/channels';

@injectable()
export default class {
  private readonly playerManager: PlayerManager;
  private readonly queueManager: QueueManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Managers.Queue) queueManager: QueueManager) {
    this.playerManager = playerManager;
    this.queueManager = queueManager;
  }

  async execute(msg: Message): Promise<boolean> {
    if (msg.content.startsWith('say') && msg.content.endsWith('muse')) {
      const res = msg.content.slice(3, msg.content.indexOf('muse')).trim();

      await msg.channel.send(res);
      return true;
    }

    if (msg.content.includes('packers')) {
      const queue = this.queueManager.get(msg.guild!.id);
      const player = this.playerManager.get(msg.guild!.id);

      const [channel, n] = getMostPopularVoiceChannel(msg.guild!);

      await msg.channel.send('GO PACKERS GO!!!');

      if (!player.voiceConnection && n === 0) {
        return false;
      }

      if (!player.voiceConnection) {
        await player.connect(channel);
      }

      const isPlaying = queue.getCurrent() !== null;
      let oldPosition = 0;

      queue.add({title: 'GO PACKERS!', artist: 'Unknown', url: 'https://www.youtube.com/watch?v=qkdtID7mY3E', length: 204, playlist: null, isLive: false});

      if (isPlaying) {
        oldPosition = player.getPosition();
        queue.forward();
      }

      await player.seek(8);

      return new Promise((resolve, reject) => {
        try {
          setTimeout(async () => {
            queue.removeCurrent();

            if (isPlaying) {
              await player.seek(oldPosition);
            } else {
              player.disconnect();
            }

            resolve(true);
          }, 10000);
        } catch (error) {
          reject(error);
        }
      });
    }

    return false;
  }
}
