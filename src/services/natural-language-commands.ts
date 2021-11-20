import {inject, injectable} from 'inversify';
import {Message, Guild, GuildMember} from 'discord.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {QueuedSong} from '../services/player.js';
import {getMostPopularVoiceChannel, getMemberVoiceChannel} from '../utils/channels.js';

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

    return false;
  }

  private async playClip(guild: Guild, member: GuildMember, song: QueuedSong, position: number, duration: number): Promise<void> {
    const player = this.playerManager.get(guild.id);

    const [channel, n] = getMemberVoiceChannel(member) ?? getMostPopularVoiceChannel(guild);

    if (!player.voiceConnection && n === 0) {
      return;
    }

    if (!player.voiceConnection) {
      await player.connect(channel);
    }

    const isPlaying = player.getCurrent() !== null;
    let oldPosition = 0;

    player.add(song, {immediate: true});

    if (isPlaying) {
      oldPosition = player.getPosition();

      player.manualForward(1);
    }

    await player.seek(position);

    return new Promise((resolve, reject) => {
      try {
        setTimeout(async () => {
          if (player.getCurrent()?.title === song.title) {
            player.removeCurrent();

            if (isPlaying) {
              await player.back();
              await player.seek(oldPosition);
            }
          }

          resolve();
        }, duration * 1000);
      } catch (error: unknown) {
        reject(error);
      }
    });
  }
}
