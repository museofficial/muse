import {inject, injectable} from 'inversify';
import {VoiceConnection, VoiceChannel} from 'discord.js';
import {promises as fs, createWriteStream} from 'fs';
import {Readable} from 'stream';
import path from 'path';
import hasha from 'hasha';
import ytdl from 'ytdl-core';
import {WriteStream} from 'fs-capacitor';
import prism from 'prism-media';
import {TYPES} from '../types';
import Queue, {QueuedSong} from './queue';

export enum Status {
  Playing,
  Paused,
  Disconnected
}

export interface GuildPlayer {
  status: Status;
  voiceConnection: VoiceConnection | null;
}

@injectable()
export default class {
  private readonly guildPlayers = new Map<string, GuildPlayer>();
  private readonly queue: Queue;
  private readonly cacheDir: string;

  constructor(@inject(TYPES.Services.Queue) queue: Queue, @inject(TYPES.Config.CACHE_DIR) cacheDir: string) {
    this.queue = queue;
    this.cacheDir = cacheDir;
  }

  async connect(guildId: string, channel: VoiceChannel): Promise<void> {
    this.initGuild(guildId);

    const guildPlayer = this.guildPlayers.get(guildId);

    const conn = await channel.join();

    guildPlayer!.voiceConnection = conn;

    this.guildPlayers.set(guildId, guildPlayer!);
  }

  disconnect(guildId: string): void {
    this.initGuild(guildId);

    const guildPlayer = this.guildPlayers.get(guildId);

    if (guildPlayer?.voiceConnection) {
      guildPlayer.voiceConnection.disconnect();
    }
  }

  async seek(guildId: string, positionSeconds: number): Promise<void> {
    const guildPlayer = this.get(guildId);
    if (guildPlayer.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    const currentSong = this.getCurrentSong(guildId);

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    await this.waitForCache(currentSong.url);

    guildPlayer.voiceConnection.play(this.getCachedPath(currentSong.url), {seek: positionSeconds});
  }

  async play(guildId: string): Promise<void> {
    const guildPlayer = this.get(guildId);
    if (guildPlayer.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    if (guildPlayer.status === Status.Playing) {
      // Already playing, return
      return;
    }

    const currentSong = this.getCurrentSong(guildId);

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    if (await this.isCached(currentSong.url)) {
      this.get(guildId).voiceConnection!.play(this.getCachedPath(currentSong.url));
    } else {
      const stream = await this.getStream(currentSong.url);
      this.get(guildId).voiceConnection!.play(stream, {type: 'webm/opus'});
    }

    guildPlayer.status = Status.Playing;

    this.guildPlayers.set(guildId, guildPlayer);
  }

  get(guildId: string): GuildPlayer {
    this.initGuild(guildId);

    return this.guildPlayers.get(guildId) as GuildPlayer;
  }

  private getCurrentSong(guildId: string): QueuedSong|null {
    const songs = this.queue.get(guildId);

    if (songs.length === 0) {
      return null;
    }

    return songs[0];
  }

  private initGuild(guildId: string): void {
    if (!this.guildPlayers.get(guildId)) {
      this.guildPlayers.set(guildId, {status: Status.Disconnected, voiceConnection: null});
    }
  }

  private getCachedPath(url: string): string {
    const hash = hasha(url);
    return path.join(this.cacheDir, `${hash}.webm`);
  }

  private getCachedPathTemp(url: string): string {
    const hash = hasha(url);

    return path.join('/tmp', `${hash}.webm`);
  }

  private async isCached(url: string): Promise<boolean> {
    try {
      await fs.access(this.getCachedPath(url));

      return true;
    } catch (_) {
      return false;
    }
  }

  private async waitForCache(url: string, maxRetries = 50, retryDelay = 500): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      if (await this.isCached(url)) {
        resolve();
      } else {
        let nOfChecks = 0;

        const cachedCheck = setInterval(async () => {
          if (await this.isCached(url)) {
            clearInterval(cachedCheck);
            resolve();
          } else {
            nOfChecks++;

            if (nOfChecks > maxRetries) {
              clearInterval(cachedCheck);
              reject(new Error('Timed out waiting for file to become cached.'));
            }
          }
        }, retryDelay);
      }
    });
  }

  private async getStream(url: string): Promise<Readable|string> {
    const cachedPath = this.getCachedPath(url);

    if (await this.isCached(url)) {
      return cachedPath;
    }

    // Not yet cached, must download
    const info = await ytdl.getInfo(url);

    const {formats} = info;

    const filter = (format: ytdl.videoFormat): boolean => format.codecs === 'opus' && format.container === 'webm' && format.audioSampleRate !== undefined && parseInt(format.audioSampleRate, 10) === 48000;

    let format = formats.find(filter);
    let canDirectPlay = true;

    const nextBestFormat = (formats: ytdl.videoFormat[]): ytdl.videoFormat => {
      formats = formats
        .filter(format => format.averageBitrate)
        .sort((a, b) => b.averageBitrate - a.averageBitrate);
      return formats.find(format => !format.bitrate) ?? formats[0];
    };

    if (!format) {
      format = nextBestFormat(info.formats);
      canDirectPlay = false;
    }

    const cacheTempPath = this.getCachedPathTemp(url);
    const cacheStream = createWriteStream(cacheTempPath);

    cacheStream.on('finish', async () => {
      await fs.rename(cacheTempPath, cachedPath);
    });

    let youtubeStream: Readable;

    if (canDirectPlay) {
      youtubeStream = ytdl.downloadFromInfo(info, {format});
    } else {
      youtubeStream = new prism.FFmpeg({
        args: [
          '-reconnect',
          '1',
          '-reconnect_streamed',
          '1',
          '-reconnect_delay_max',
          '5',
          '-i',
          format.url,
          '-loglevel',
          'verbose',
          '-vn',
          '-acodec',
          'libopus',
          '-f',
          'webm'
        ]
      });
    }

    const capacitor = new WriteStream();

    youtubeStream.pipe(capacitor);

    capacitor.createReadStream().pipe(cacheStream);

    return capacitor.createReadStream();
  }
}
