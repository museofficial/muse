import {VoiceChannel, Snowflake} from 'discord.js';
import {Readable} from 'stream';
import hasha from 'hasha';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import shuffle from 'array-shuffle';
import {spawn} from 'child_process';
import {
  AudioPlayer,
  AudioPlayerState,
  AudioPlayerStatus, AudioResource,
  createAudioPlayer,
  createAudioResource, DiscordGatewayAdapterCreator,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import FileCacheProvider from './file-cache.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {Setting} from '@prisma/client';
import ytdl, {videoFormat} from '@distube/ytdl-core';

export enum MediaSource {
  Youtube,
  HLS,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string; // For YT, it's the video ID (not the full URI)
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
}
export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
}

interface VideoFormat {
  url: string;
  itag: string | number;
  codecs?: string;
  container?: string;
  audioSampleRate?: string;
  averageBitrate?: number;
  bitrate?: string | number;
  isLive?: boolean;
  loudnessDb?: number;
}

interface YtDlpFormat {
  url?: string;
  format_id?: string;
  acodec?: string;
  vcodec?: string;
  ext?: string;
  asr?: number;
  abr?: number;
  tbr?: number;
}

interface YtDlpResponse {
  formats?: YtDlpFormat[];
  is_live?: boolean;
  duration?: number;
}

type YTDLVideoFormat = VideoFormat;

export const DEFAULT_VOLUME = 100;

export default class {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  private currentChannel: VoiceChannel | undefined;
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private lastSongURL = '';

  private positionInSeconds = 0;
  private readonly fileCache: FileCacheProvider;
  private disconnectTimer: NodeJS.Timeout | null = null;

  private readonly channelToSpeakingUsers: Map<string, Set<string>> =
  new Map();

  constructor(fileCache: FileCacheProvider, guildId: string) {
    this.fileCache = fileCache;
    this.guildId = guildId;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    // Always get freshest default volume setting value
    const settings = await getGuildSettings(this.guildId);
    const {defaultVolume = DEFAULT_VOLUME} = settings;
    this.defaultVolume = defaultVolume;

    this.voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: true,
      adapterCreator: channel.guild
        .voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    const guildSettings = await getGuildSettings(this.guildId);

    // Workaround to disable keepAlive
    this.voiceConnection.on('stateChange', (oldState, newState) => {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      const oldNetworking = Reflect.get(oldState, 'networking');
      const newNetworking = Reflect.get(newState, 'networking');

      const networkStateChangeHandler = (
        _: any,
        newNetworkState: any,
      ) => {
        const newUdp = Reflect.get(newNetworkState, 'udp');
        clearInterval(newUdp?.keepAliveInterval);
      };

      oldNetworking?.off('stateChange', networkStateChangeHandler);
      newNetworking?.on('stateChange', networkStateChangeHandler);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

      this.currentChannel = channel;
      if (newState.status === VoiceConnectionStatus.Ready) {
        this.registerVoiceActivityListener(guildSettings);
      }
    });
  }

  disconnect(): void {
    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      this.loopCurrentSong = false;
      this.voiceConnection.destroy();
      this.audioPlayer?.stop(true);

      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
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

    let realPositionSeconds = positionSeconds;
    let to: number | undefined;
    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
      to = currentSong.length + currentSong.offset;
    }

    const stream = await this.getStream(currentSong, {
      seek: realPositionSeconds,
      to,
    });
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        // Needs to be somewhat high for livestreams
        maxMissedFrames: 50,
      },
    });
    this.voiceConnection.subscribe(this.audioPlayer);
    this.playAudioPlayerResource(this.createAudioStream(stream));
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

    // Cancel any pending idle disconnection
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Resume from paused state
    if (
      this.status === STATUS.PAUSED
            && currentSong.url === this.nowPlaying?.url
    ) {
      if (this.audioPlayer) {
        this.audioPlayer.unpause();
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
      let positionSeconds: number | undefined;
      let to: number | undefined;
      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
        to = currentSong.length + currentSong.offset;
      }

      const stream = await this.getStream(currentSong, {
        seek: positionSeconds,
        to,
      });
      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // Needs to be somewhat high for livestreams
          maxMissedFrames: 50,
        },
      });
      this.voiceConnection.subscribe(this.audioPlayer);
      this.playAudioPlayerResource(this.createAudioStream(stream));

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
      await this.forward(1);

      if (
        (error as {statusCode: number}).statusCode === 410
                && currentSong
      ) {
        const channelId = currentSong.addedInChannelId;

        if (channelId) {
          return;
        }
      }

      throw error;
    }
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();
  }

  async forward(skip: number): Promise<void> {
    this.manualForward(skip);

    try {
      if (this.getCurrent() && this.status !== STATUS.PAUSED) {
        await this.play();
      } else {
        this.status = STATUS.IDLE;
        this.audioPlayer?.stop(true);

        const settings = await getGuildSettings(this.guildId);

        const {secondsToWaitAfterQueueEmpties} = settings;
        if (secondsToWaitAfterQueueEmpties !== 0) {
          this.disconnectTimer = setTimeout(() => {
            // Make sure we are not accidentally playing
            // when disconnecting
            if (this.status === STATUS.IDLE) {
              this.disconnect();
            }
          }, secondsToWaitAfterQueueEmpties * 1000);
        }
      }
    } catch (error: unknown) {
      this.queuePosition--;
      throw error;
    }
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {
      turnDownVolumeWhenPeopleSpeak,
      turnDownVolumeWhenPeopleSpeakTarget,
    } = guildSettings;
    if (!turnDownVolumeWhenPeopleSpeak || !this.voiceConnection) {
      return;
    }

    this.voiceConnection.receiver.speaking.on('start', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel?.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(
        turnDownVolumeWhenPeopleSpeakTarget,
      );
    });

    this.voiceConnection.receiver.speaking.on('end', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel.id;
      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.delete(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(
        turnDownVolumeWhenPeopleSpeakTarget,
      );
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(
    turnDownVolumeWhenPeopleSpeakTarget: number,
  ): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(
      this.currentChannel.id,
    );
    if (speakingUsers && speakingUsers.size > 0) {
      this.setVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else {
      this.setVolume(this.defaultVolume);
    }
  }

  canGoForward(skip: number) {
    return this.queuePosition + skip - 1 < this.queue.length;
  }

  manualForward(skip: number): void {
    if (this.canGoForward(skip)) {
      this.queuePosition += skip;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) {
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

  /**
     * Returns queue, not including the current song.
     * @returns {QueuedSong[]}
     */
  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, {immediate = false} = {}): void {
    if (song.playlist || !immediate) {
      // Add to end of queue
      this.queue.push(song);
    } else {
      // Add as the next song to be played
      const insertAt = this.queuePosition + 1;
      this.queue = [
        ...this.queue.slice(0, insertAt),
        song,
        ...this.queue.slice(insertAt),
      ];
    }
  }

  shuffle(): void {
    const shuffledSongs = shuffle(this.queue.slice(this.queuePosition + 1));

    this.queue = [
      ...this.queue.slice(0, this.queuePosition + 1),
      ...shuffledSongs,
    ];
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

  removeFromQueue(index: number, amount = 1): void {
    this.queue.splice(this.queuePosition + index, amount);
  }

  removeCurrent(): void {
    this.queue = [
      ...this.queue.slice(0, this.queuePosition),
      ...this.queue.slice(this.queuePosition + 1),
    ];
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  stop(): void {
    this.disconnect();
    this.queuePosition = 0;
    this.queue = [];
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new Error('Move index is outside the range of the queue.');
    }

    this.queue.splice(
      this.queuePosition + to,
      0,
      this.queue.splice(this.queuePosition + from, 1)[0],
    );

    return this.queue[this.queuePosition + to];
  }

  setVolume(level: number): void {
    // Level should be a number between 0 and 100 = 0% => 100%
    this.volume = level;
    this.setAudioPlayerVolume(level);
  }

  getVolume(): number {
    // Only use default volume if player volume is not already set (in the event of a reconnect we shouldn't reset)
    return this.volume ?? this.defaultVolume;
  }

  private async getVideoInfoWithYtDlp(url: string): Promise<YtDlpResponse> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        '--dump-json',
        '--no-warnings',
        url,
      ]);

      let stdout = '';
      let stderr = '';

      ytDlp.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ytDlp.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ytDlp.on('close', (code: number) => {
        if (code === 0) {
          try {
            const info = JSON.parse(stdout) as YtDlpResponse;
            resolve(info);
          } catch (parseError: unknown) {
            reject(
              new Error(
                `Failed to parse yt-dlp JSON output: ${String(
                  parseError,
                )}`,
              ),
            );
          }
        } else {
          reject(
            new Error(`yt-dlp failed with code ${code}: ${stderr}`),
          );
        }
      });

      ytDlp.on('error', (error: Error) => {
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  private extractVideoId(url: string): string {
    const regex
            = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = regex.exec(url);
    return match?.[1] ?? url;
  }

  private async getYouTubeInfo(url: string): Promise<{
    formats: VideoFormat[];
    isLive: boolean;
    lengthSeconds: string;
  }> {
    const videoId = this.extractVideoId(url);

    // Construct full YouTube URL if we only have a video ID
    const fullUrl
            = url.includes('youtube.com') || url.includes('youtu.be')
              ? url
              : `https://www.youtube.com/watch?v=${videoId}`;

    const info = await this.getVideoInfoWithYtDlp(fullUrl);

    const formats: VideoFormat[] = (info.formats ?? []).map(
      (format: YtDlpFormat) => ({
        url: format.url ?? '',
        itag: format.format_id ?? '',
        codecs:
                    format.acodec && format.acodec !== 'none'
                      ? format.acodec
                      : format.vcodec ?? '',
        container: format.ext ?? '',
        audioSampleRate: format.asr?.toString(),
        averageBitrate: format.abr,
        bitrate: format.tbr,
        isLive: info.is_live ?? false,
      }),
    );

    return {
      formats,
      isLive: info.is_live ?? false,
      lengthSeconds: info.duration?.toString() ?? '0',
    };
  }

  private getHashForCache(url: string): string {
    return hasha(url);
  }

  private async getStream(
    song: QueuedSong,
    options: {seek?: number; to?: number} = {},
  ): Promise<Readable> {
    if (this.status === STATUS.PLAYING) {
      this.audioPlayer?.stop();
    } else if (this.status === STATUS.PAUSED) {
      this.audioPlayer?.stop(true);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({url: song.url, cacheKey: song.url});
    }

    let ffmpegInput: string | null;
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    let format: YTDLVideoFormat | undefined;

    ffmpegInput = await this.fileCache.getPathFor(
      this.getHashForCache(song.url),
    );

    if (!ffmpegInput) {
      // Not yet cached, must download
      const info = await this.getYouTubeInfo(song.url);

      const {formats} = info;

      // Primary filter: Look for the ideal format (opus codec, webm container, 48kHz)
      const filter = (format: VideoFormat): boolean => {
        const hasOpusCodec
                    = format.codecs === 'opus' || format.codecs?.includes('opus');
        const hasWebmContainer = format.container === 'webm';
        const has48kSampleRate
                    = format.audioSampleRate
                    && parseInt(format.audioSampleRate, 10) === 48000;
        const hasUrl = Boolean(format.url);

        return Boolean(
          hasOpusCodec
                        && hasWebmContainer
                        && has48kSampleRate
                        && hasUrl,
        );
      };

      // Secondary filter: Look for any audio format with opus codec
      const audioOpusFilter = (format: VideoFormat): boolean => {
        const hasOpusCodec
                    = format.codecs === 'opus' || format.codecs?.includes('opus');
        const hasUrl = Boolean(format.url);
        const isAudioOnly
                    = format.container
                    && ['webm', 'm4a', 'mp4'].includes(format.container);

        return Boolean(hasOpusCodec && hasUrl && isAudioOnly);
      };

      // Tertiary filter: Look for any audio format
      const audioFilter = (format: VideoFormat): boolean => {
        const hasUrl = Boolean(format.url);
        const isAudioOnly
                    = format.container
                    && ['webm', 'm4a', 'mp4', 'ogg'].includes(format.container);
        const hasAudioCodec
                    = format.codecs
                    && ['opus', 'mp4a', 'aac'].some(
                      codec =>
                        format.codecs === codec
                            || format.codecs?.includes(codec),
                    );

        return Boolean(hasUrl && isAudioOnly && hasAudioCodec);
      };

      // Try filters in order of preference
      format
                = formats.find(filter)
                ?? formats.find(audioOpusFilter)
                ?? formats.find(audioFilter);

      const nextBestFormat = (
        formats: VideoFormat[],
      ): VideoFormat | undefined => {
        if (formats.length < 1) {
          return undefined;
        }

        if (formats[0].isLive) {
          formats = formats.sort(
            (a, b) =>
              (b as unknown as {audioBitrate: number})
                .audioBitrate
                            - (a as unknown as {audioBitrate: number})
                              .audioBitrate,
          );

          return formats.find(format =>
            [128, 127, 120, 96, 95, 94, 93].includes(
              parseInt(format.itag as unknown as string, 10),
            ),
          );
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
          throw new Error(
            `Can't find suitable format. Available formats: ${
              info.formats.length
            }, with URLs: ${
              info.formats.filter(f => f.url).length
            }`,
          );
        }
      }

      ffmpegInput = format.url;

      // Don't cache livestreams or long videos
      const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes
      shouldCacheVideo
                = !info.isLive
                && parseInt(info.lengthSeconds, 10) < MAX_CACHE_LENGTH_SECONDS
                && !options.seek;

      ffmpegInputOptions.push(
        ...[
          '-reconnect',
          '1',
          '-reconnect_streamed',
          '1',
          '-reconnect_delay_max',
          '5',
        ],
      );
    }

    if (options.seek) {
      ffmpegInputOptions.push('-ss', options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push('-to', options.to.toString());
    }

    return this.createReadStream({
      url: ffmpegInput,
      cacheKey: song.url,
      ffmpegInputOptions,
      cache: shouldCacheVideo,
      volumeAdjustment: format?.loudnessDb
        ? `${-format.loudnessDb}dB`
        : undefined,
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

    if (
      this.voiceConnection.listeners(VoiceConnectionStatus.Disconnected)
        .length === 0
    ) {
      this.voiceConnection.on(
        VoiceConnectionStatus.Disconnected,
        this.onVoiceConnectionDisconnect.bind(this),
      );
    }

    if (!this.audioPlayer) {
      return;
    }

    if (this.audioPlayer.listeners('stateChange').length === 0) {
      this.audioPlayer.on(
        AudioPlayerStatus.Idle,
        this.onAudioPlayerIdle.bind(this),
      );
    }
  }

  private onVoiceConnectionDisconnect(): void {
    this.disconnect();
  }

  private async onAudioPlayerIdle(
    _oldState: AudioPlayerState,
    newState: AudioPlayerState,
  ): Promise<void> {
    // Automatically advance queued song at end
    if (
      this.loopCurrentSong
            && newState.status === AudioPlayerStatus.Idle
            && this.status === STATUS.PLAYING
    ) {
      await this.seek(0);
      return;
    }

    // Automatically re-add current song to queue
    if (
      this.loopCurrentQueue
            && newState.status === AudioPlayerStatus.Idle
            && this.status === STATUS.PLAYING
    ) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        throw new Error('No song currently playing.');
      }
    }

    if (
      newState.status === AudioPlayerStatus.Idle
            && this.status === STATUS.PLAYING
    ) {
      await this.forward(1);
      // Auto announce the next song if configured to
      const settings = await getGuildSettings(this.guildId);
      const {autoAnnounceNextSong} = settings;
      if (autoAnnounceNextSong && this.currentChannel) {
        await this.currentChannel.send({
          embeds: this.getCurrent()
            ? [buildPlayingMessageEmbed(this)]
            : [],
        });
      }
    }
  }

  private async createReadStream(options: {
    url: string;
    cacheKey: string;
    ffmpegInputOptions?: string[];
    cache?: boolean;
    volumeAdjustment?: string;
  }): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const capacitor = new WriteStream();

      if (options?.cache) {
        const cacheStream = this.fileCache.createWriteStream(
          this.getHashForCache(options.cacheKey),
        );
        capacitor.createReadStream().pipe(cacheStream);
      }

      const returnedStream = capacitor.createReadStream();
      let hasReturnedStreamClosed = false;

      const stream = ffmpeg(options.url)
        .inputOptions(options?.ffmpegInputOptions ?? ['-re'])
        .noVideo()
        .audioCodec('libopus')
        .outputFormat('webm')
        .addOutputOption([
          '-filter:a',
          `volume=${options?.volumeAdjustment ?? '1'}`,
        ])
        .on('error', error => {
          if (!hasReturnedStreamClosed) {
            reject(error);
          }
        });

      stream.pipe(capacitor);

      returnedStream.on('close', () => {
        if (!options.cache) {
          stream.kill('SIGKILL');
        }

        hasReturnedStreamClosed = true;
      });

      resolve(returnedStream);
    });
  }

  private createAudioStream(stream: Readable) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    // Audio resource expects a float between 0 and 1 to represent level percentage
    this.audioResource?.volume?.setVolume(
      (level ?? this.getVolume()) / 100,
    );
  }
}
