import {VoiceConnection, VoiceChannel, StreamDispatcher} from 'discord.js';
import {promises as fs, createWriteStream} from 'fs';
import {Readable, PassThrough} from 'stream';
import path from 'path';
import hasha from 'hasha';
import ytdl from 'ytdl-core';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import shuffle from 'array-shuffle';

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface QueuedSong {
  title: string;
  artist: string;
  url: string;
  length: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
}

export enum STATUS {
  PLAYING,
  PAUSED
}

export default class {
  public status = STATUS.PAUSED;
  public voiceConnection: VoiceConnection | null = null;
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  private readonly cacheDir: string;
  private dispatcher: StreamDispatcher | null = null;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private lastSongURL = '';

  private positionInSeconds = 0;

  constructor(cacheDir: string) {
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

      this.voiceConnection = null;
      this.dispatcher = null;
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;

    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    if (positionSeconds > currentSong.length) {
      throw new Error('Seek position is outside the range of the song.');
    }

    const stream = await this.getStream(currentSong.url, {seek: positionSeconds});
    this.dispatcher = this.voiceConnection.play(stream, {type: 'webm/opus', bitrate: 'auto'});

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

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    // Resume from paused state
    if (this.status === STATUS.PAUSED && currentSong.url === this.nowPlaying?.url) {
      if (this.dispatcher) {
        this.dispatcher.resume();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        return;
      }

      // Was disconnected, need to recreate stream
      if (!currentSong.isLive) {
        return this.seek(this.getPosition());
      }
    }

    try {
      const stream = await this.getStream(currentSong.url);
      this.dispatcher = this.voiceConnection.play(stream, {type: 'webm/opus'});

      this.attachListeners();

      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;

      if (currentSong.url === this.lastSongURL) {
        this.startTrackingPosition();
      } else {
        // Reset position counter
        this.startTrackingPosition(0);
        this.lastSongURL = currentSong.url;
      }
    } catch (error: unknown) {
      this.removeCurrent();
      throw error;
    }
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

  async forward(skip: number): Promise<void> {
    this.manualForward(skip);

    try {
      if (this.getCurrent() && this.status !== STATUS.PAUSED) {
        await this.play();
      } else {
        this.status = STATUS.PAUSED;
        this.disconnect();
      }
    } catch (error: unknown) {
      this.queuePosition--;
      throw error;
    }
  }

  manualForward(skip: number): void {
    if ((this.queuePosition + skip - 1) < this.queue.length) {
      this.queuePosition += skip;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  async back(): Promise<void> {
    if (this.queuePosition - 1 >= 0) {
      this.queuePosition--;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();

      if (this.status !== STATUS.PAUSED) {
        await this.play();
      }
    } else {
      throw new Error('No songs in queue to go back to.');
    }
  }

  getCurrent(): QueuedSong | null {
    if (this.queue[this.queuePosition]) {
      return this.queue[this.queuePosition];
    }

    return null;
  }

  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, {immediate = false} = {}): void {
    if (song.playlist) {
      // Add to end of queue
      this.queue.push(song);
    } else {
      // Not from playlist, add immediately
      let insertAt = this.queuePosition + 1;

      if (!immediate) {
      // Loop until playlist song
        this.queue.some(song => {
          if (song.playlist) {
            return true;
          }

          insertAt++;
          return false;
        });
      }

      this.queue = [...this.queue.slice(0, insertAt), song, ...this.queue.slice(insertAt)];
    }
  }

  shuffle(): void {
    const shuffledSongs = shuffle(this.queue.slice(this.queuePosition + 1));

    this.queue = [...this.queue.slice(0, this.queuePosition + 1), ...shuffledSongs];
  }

  clear(): void {
    const newQueue = [];

    // Don't clear curently playing song
    const current = this.getCurrent();

    if (current) {
      newQueue.push(current);
    }

    this.queuePosition = 0;
    this.queue = newQueue;
  }

  removeCurrent(): void {
    this.queue = [...this.queue.slice(0, this.queuePosition), ...this.queue.slice(this.queuePosition + 1)];
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
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
    } catch (_: unknown) {
      return false;
    }
  }

  private async getStream(url: string, options: {seek?: number} = {}): Promise<Readable> {
    const cachedPath = this.getCachedPath(url);

    let ffmpegInput = '';
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    let format: ytdl.videoFormat | undefined;

    if (await this.isCached(url)) {
      ffmpegInput = cachedPath;

      if (options.seek) {
        ffmpegInputOptions.push('-ss', options.seek.toString());
      }
    } else {
      // Not yet cached, must download
      const info = await ytdl.getInfo(url);

      const {formats} = info;

      const filter = (format: ytdl.videoFormat): boolean => format.codecs === 'opus' && format.container === 'webm' && format.audioSampleRate !== undefined && parseInt(format.audioSampleRate, 10) === 48000;

      format = formats.find(filter);

      const nextBestFormat = (formats: ytdl.videoFormat[]): ytdl.videoFormat | undefined => {
        if (formats[0].isLive) {
          formats = formats.sort((a, b) => (b as unknown as {audioBitrate: number}).audioBitrate - (a as unknown as {audioBitrate: number}).audioBitrate); // Bad typings

          return formats.find(format => [128, 127, 120, 96, 95, 94, 93].includes(parseInt(format.itag as unknown as string, 10))); // Bad typings
        }

        formats = formats
          .filter(format => format.averageBitrate)
          .sort((a, b) => {
            if (a && b) {
              return b.averageBitrate! - a.averageBitrate!;
            }

            return 0;
          });
        return formats.find(format => !format.bitrate) ?? formats[0];
      };

      if (!format) {
        format = nextBestFormat(info.formats);

        if (!format) {
          // If still no format is found, throw
          throw new Error('Can\'t find suitable format.');
        }
      }

      ffmpegInput = format.url;

      // Don't cache livestreams or long videos
      const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes
      shouldCacheVideo = !info.player_response.videoDetails.isLiveContent && parseInt(info.videoDetails.lengthSeconds, 10) < MAX_CACHE_LENGTH_SECONDS && !options.seek;

      ffmpegInputOptions.push(...[
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5'
      ]);

      if (options.seek) {
        // Fudge seek position since FFMPEG doesn't do a great job
        ffmpegInputOptions.push('-ss', (options.seek + 7).toString());
      }
    }

    // Create stream and pipe to capacitor
    return new Promise((resolve, reject) => {
      const youtubeStream = ffmpeg(ffmpegInput)
        .inputOptions(ffmpegInputOptions)
        .noVideo()
        .audioCodec('libopus')
        .outputFormat('webm')
        .on('error', error => {
          console.error(error);
          reject(error);
        })
        .pipe() as PassThrough;

      const capacitor = new WriteStream();

      youtubeStream.pipe(capacitor);

      // Cache video if necessary
      if (shouldCacheVideo) {
        const cacheTempPath = this.getCachedPathTemp(url);
        const cacheStream = createWriteStream(cacheTempPath);

        cacheStream.on('finish', async () => {
          // Only move if size is non-zero (may have errored out)
          const stats = await fs.stat(cacheTempPath);

          if (stats.size !== 0) {
            await fs.rename(cacheTempPath, cachedPath);
          }
        });

        capacitor.createReadStream().pipe(cacheStream);
      }

      resolve(capacitor.createReadStream());
    });
  }

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition !== undefined) {
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

    this.voiceConnection.on('disconnect', this.onVoiceConnectionDisconnect.bind(this));

    if (!this.dispatcher) {
      return;
    }

    this.dispatcher.on('speaking', this.onVoiceConnectionSpeaking.bind(this));
  }

  private onVoiceConnectionDisconnect(): void {
    this.disconnect(false);
  }

  private async onVoiceConnectionSpeaking(isSpeaking: boolean): Promise<void> {
    // Automatically advance queued song at end
    if (!isSpeaking && this.status === STATUS.PLAYING) {
      await this.forward(1);
    }
  }
}
