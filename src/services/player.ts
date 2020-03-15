import {VoiceConnection, VoiceChannel, StreamDispatcher} from 'discord.js';
import {promises as fs, createWriteStream} from 'fs';
import {Readable, PassThrough} from 'stream';
import path from 'path';
import hasha from 'hasha';
import ytdl from 'ytdl-core';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import Queue, {QueuedSong} from './queue';

export enum STATUS {
  PLAYING,
  PAUSED,
  DISCONNECTED
}

export default class {
  public status = STATUS.DISCONNECTED;
  private readonly queue: Queue;
  private readonly cacheDir: string;
  private voiceConnection: VoiceConnection | null = null;
  private dispatcher: StreamDispatcher | null = null;

  constructor(queue: Queue, cacheDir: string) {
    this.queue = queue;
    this.cacheDir = cacheDir;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    const conn = await channel.join();

    this.voiceConnection = conn;
  }

  disconnect(): void {
    if (this.voiceConnection) {
      this.voiceConnection.disconnect();
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    const currentSong = this.getCurrentSong();

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    await this.waitForCache(currentSong.url);

    this.attachListeners(this.voiceConnection.play(this.getCachedPath(currentSong.url), {seek: positionSeconds}));
  }

  async play(): Promise<void> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    // Resume from paused state
    if (this.status === STATUS.PAUSED && this.dispatcher) {
      this.dispatcher.resume();
      this.status = STATUS.PLAYING;
      return;
    }

    const currentSong = this.getCurrentSong();

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    let dispatcher: StreamDispatcher;

    if (await this.isCached(currentSong.url)) {
      dispatcher = this.voiceConnection.play(this.getCachedPath(currentSong.url));
    } else {
      const stream = await this.getStream(currentSong.url);
      dispatcher = this.voiceConnection.play(stream, {type: 'webm/opus'});
    }

    this.attachListeners(dispatcher);

    this.status = STATUS.PLAYING;
    this.dispatcher = dispatcher;
  }

  pause(): void {
    if (!this.dispatcher || this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.dispatcher.pause();
  }

  private getCurrentSong(): QueuedSong|null {
    const songs = this.queue.get();

    if (songs.length === 0) {
      return null;
    }

    return songs[0];
  }

  private getCachedPath(url: string): string {
    return path.join(this.cacheDir, hasha(url));
  }

  private getCachedPathTemp(url: string): string {
    return path.join('/tmp', hasha(url));
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

    const nextBestFormat = (formats: ytdl.videoFormat[]): ytdl.videoFormat | undefined => {
      if (formats[0].live) {
        formats = formats.sort((a, b) => (b as any).audioBitrate - (a as any).audioBitrate); // Bad typings

        return formats.find(format => [128, 127, 120, 96, 95, 94, 93].includes(parseInt(format.itag as unknown as string, 10))); // Bad typings
      }

      formats = formats
        .filter(format => format.averageBitrate)
        .sort((a, b) => b.averageBitrate - a.averageBitrate);
      return formats.find(format => !format.bitrate) ?? formats[0];
    };

    if (!format) {
      format = nextBestFormat(info.formats);
      canDirectPlay = false;

      if (!format) {
        // If still no format is found, throw
        throw new Error('Can\'t find suitable format.');
      }
    }

    let youtubeStream: Readable;

    if (canDirectPlay) {
      youtubeStream = ytdl.downloadFromInfo(info, {format});
    } else {
      youtubeStream = ffmpeg(format.url).inputOptions([
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5'
      ]).noVideo().audioCodec('libopus').outputFormat('webm').pipe() as PassThrough;
    }

    const capacitor = new WriteStream();

    youtubeStream.pipe(capacitor);

    // Don't cache livestreams
    if (!info.player_response.videoDetails.isLiveContent) {
      const cacheTempPath = this.getCachedPathTemp(url);
      const cacheStream = createWriteStream(cacheTempPath);

      cacheStream.on('finish', async () => {
        await fs.rename(cacheTempPath, cachedPath);
      });

      capacitor.createReadStream().pipe(cacheStream);
    }

    return capacitor.createReadStream();
  }

  private attachListeners(stream: StreamDispatcher): void {
    stream.on('speaking', async isSpeaking => {
      // Automatically advance queued song at end
      if (!isSpeaking && this.status === STATUS.PLAYING) {
        if (this.queue.get().length > 0) {
          this.queue.forward();
          await this.play();
        }
      }
    });

    stream.on('close', () => {
      // Remove dispatcher from guild player
      this.dispatcher = null;

      // TODO: set voiceConnection null as well?
    });
  }
}
