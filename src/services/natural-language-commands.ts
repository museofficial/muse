import {inject, injectable} from 'inversify';
import {Message} from 'discord.js';
import {TYPES} from '../types';
import PlayerManager from '../managers/player';
import {getMostPopularVoiceChannel} from '../utils/channels';

@injectable()
export default class {
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  async execute(msg: Message): Promise<boolean> {
    if (msg.content.startsWith('say') && msg.content.endsWith('muse')) {
      const res = msg.content.slice(3, msg.content.indexOf('muse')).trim();

      await msg.channel.send(res);
      return true;
    }

    if (msg.content.includes('packers')) {
      const player = this.playerManager.get(msg.guild!.id);

      const [channel, n] = getMostPopularVoiceChannel(msg.guild!);

      await msg.channel.send('GO PACKERS GO!!!');

      if (!player.voiceConnection && n === 0) {
        return false;
      }

      if (!player.voiceConnection) {
        await player.connect(channel);
      }

      const isPlaying = player.getCurrent() !== null;
      let oldPosition = 0;

      player.add({title: 'GO PACKERS!', artist: 'Unknown', url: 'https://www.youtube.com/watch?v=qkdtID7mY3E', length: 204, playlist: null, isLive: false}, {immediate: true});

      if (isPlaying) {
        oldPosition = player.getPosition();

        await player.forward();
      }

      await player.seek(8);

      return new Promise((resolve, reject) => {
        try {
          setTimeout(async () => {
            player.removeCurrent();

            if (isPlaying) {
              await player.back();
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
