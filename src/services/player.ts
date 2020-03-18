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
  PAUSED
}

export default class {
  public status = STATUS.PAUSED;
  public voiceConnection: VoiceConnection | null = null;
  private readonly queue: Queue;
  private readonly cacheDir: string;
  private dispatcher: StreamDispatcher | null = null;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;

  private positionInSeconds = 0;

  constructor(queue: Queue, cacheDir: string) {
    this.queue = queue;
    this.cacheDir = cacheDir;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    const conn = await channel.join();

    this.voiceConnection = conn;
  }

  disconnect(breakConnection = true): void {
    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      if (breakConnection) {
        this.voiceConnection.disconnect();
      }

      this.positionInSeconds = 0;
      this.voiceConnection = null;
      this.dispatcher = null;
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;

    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    const currentSong = this.queue.getCurrent();

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    if (positionSeconds > currentSong.length) {
      throw new Error('Seek position is outside the range of the song.');
    }

    if (await this.isCached(currentSong.url)) {
      this.dispatcher = this.voiceConnection.play(this.getCachedPath(currentSong.url), {seek: positionSeconds});
    } else {
      const stream = await this.getStream(currentSong.url, {seek: positionSeconds});
      this.dispatcher = this.voiceConnection.play(stream, {type: 'webm/opus'});
    }

    this.attachListeners();
    this.startTrackingPosition(positionSeconds);

    this.status = STATUS.PLAYING;
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  async play(): Promise<void> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    const currentSong = this.queue.getCurrent();

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    // Resume from paused state
    if (this.status === STATUS.PAUSED && this.getPosition() !== 0 && this.dispatcher && currentSong.url === this.nowPlaying?.url) {
      this.dispatcher.resume();
      this.status = STATUS.PLAYING;
      return;
    }

    if (await this.isCached(currentSong.url)) {
      this.dispatcher = this.voiceConnection.play(this.getCachedPath(currentSong.url));
    } else {
      const stream = await this.getStream(currentSong.url);
      this.dispatcher = this.voiceConnection.play(stream, {type: 'webm/opus'});
    }

    this.attachListeners();

    this.status = STATUS.PLAYING;
    this.nowPlaying = currentSong;

    this.startTrackingPosition();
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.status = STATUS.PAUSED;

    if (this.dispatcher) {
      this.dispatcher.pause();
    }

    this.stopTrackingPosition();
  }

  private getCachedPath(url: string): string {
    return path.join(this.cacheDir, hasha(url));
  }

  private getCachedPathTemp(url: string): string {
    return path.join(this.cacheDir, 'tmp', hasha(url));
  }

  private async isCached(url: string): Promise<boolean> {
    try {
      await fs.access(this.getCachedPath(url));

      return true;
    } catch (_) {
      return false;
    }
  }

  private async getStream(url: string, options: {seek?: number} = {}): Promise<Readable|string> {
    const cachedPath = this.getCachedPath(url);

    if (await this.isCached(url)) {
      return cachedPath;
    }

    // Not yet cached, must download
    const info = await ytdl.getInfo(url);

    const {formats} = info;

    const filter = (format: ytdl.videoFormat): boolean => format.codecs === 'opus' && format.container === 'webm' && format.audioSampleRate !== undefined && parseInt(format.audioSampleRate, 10) === 48000;

    let format = formats.find(filter);

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

      if (!format) {
        // If still no format is found, throw
        throw new Error('Can\'t find suitable format.');
      }
    }

    const inputOptions = [
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5'
    ];

    if (options.seek) {
      inputOptions.push('-ss', options.seek.toString());
    }

    const youtubeStream = ffmpeg(format.url).inputOptions(inputOptions).noVideo().audioCodec('libopus').outputFormat('webm').pipe() as PassThrough;

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

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition) {
      this.positionInSeconds = initalPosition;
    }

    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }

    this.playPositionInterval = setInterval(() => {
      this.positionInSeconds++;
    }, 1000);
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    this.voiceConnection.on('disconnect', () => {
      this.disconnect(false);
    });

    if (!this.dispatcher) {
      return;
    }

    this.dispatcher.on('speaking', async isSpeaking => {
      // Automatically advance queued song at end
      if (!isSpeaking && this.status === STATUS.PLAYING) {
        if (this.queue.get().length > 0) {
          this.queue.forward();
          await this.play();
        }
      }
    });
  }
}
