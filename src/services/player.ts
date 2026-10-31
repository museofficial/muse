import {VoiceChannel} from 'discord.js';
import {Readable} from 'stream';
import {setTimeout as sleep} from 'timers/promises';
import hasha from 'hasha';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import prismMedia from 'prism-media';
import shuffle from 'array-shuffle';
import uniqueSongs from '../utils/unique-songs.js';
import type ListeningSession from './listening-session.js';
import {
  AudioPlayer,
  AudioPlayerState,
  AudioPlayerStatus, AudioResource,
  createAudioPlayer,
  createAudioResource, DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  NetworkingStatusCode,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import FileCacheProvider from './file-cache.js';
import {PlaybackAttemptTracker, type PlaybackAttemptContext, type PlaybackAttemptToken} from './playback-attempt.js';
import {
  DEFAULT_VOLUME,
  MediaSource,
  STATUS,
  type AgeRestrictedFallbackResolver,
  type PlayerEvents,
  type QueuedPlaylist,
  type QueuedSong,
  type SongMetadata,
} from './player-types.js';
import {destroyVoiceConnection, recoverVoiceConnection} from './voice-connection-recovery.js';
import debug from '../utils/debug.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getSoundCloudMediaSource, getYouTubeMediaSource, YtDlpMediaUnavailableError, type YtDlpMediaSource} from '../utils/yt-dlp.js';
import {Setting} from '@prisma/client';
import {DEFAULT_PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS} from '../utils/constants.js';
import {LocalizedError} from '../i18n/index.js';

export {DEFAULT_VOLUME, MediaSource, STATUS};
export type {AgeRestrictedFallbackResolver, PlayerEvents, QueuedPlaylist, QueuedSong, SongMetadata};

const FFMPEG_STARTUP_TIMEOUT_MS = 20_000;
const MAX_MEDIA_AVAILABILITY_WAIT_MS = 60_000;
// Fresh YouTube URLs can return 403 for several seconds before the same URL starts working.
const MEDIA_FORBIDDEN_RETRY_DELAYS_MS = [5_000, 10_000];
const PREFETCH_LEAD_SECONDS = 60;
const PREFETCH_MAX_AGE_MS = 10 * 60 * 1000;
const VOICE_CONNECTION_ATTEMPTS = 3;
const VOICE_CONNECTION_ATTEMPT_TIMEOUT_MS = 20_000;
// Caps how long an intro or outro can hold up playback or leaving.
const MAX_SOUND_CLIP_MS = 15_000;

// Volumes are percentages of the player's current volume; 100 when unset.
export type SoundClips = {intro?: string; outro?: string; introVolume?: number; outroVolume?: number};

const sanitizeFfmpegError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);

  return detail
    .replace(/https?:\/\/\S+/gi, '[media URL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
};

const getMediaIdentifierForLog = (song: QueuedSong) => (
  song.source === MediaSource.Youtube && /^[\w-]{11}$/.test(song.url)
    ? `youtube=${song.url}`
    : `sourceHash=${hasha(song.url).slice(0, 16)}`
);

export class FfmpegMediaUnavailableError extends Error {
  constructor(error: unknown, public readonly reason: 'invalid-output' | 'not-found' | 'unavailable' = 'unavailable') {
    const detail = sanitizeFfmpegError(error);
    super(`FFmpeg could not start audio transcoding${detail ? `: ${detail}` : ''}`);
    this.name = 'FfmpegMediaUnavailableError';
  }
}

export class FfmpegStartupError extends Error {
  constructor(error: unknown, public readonly forbidden = false) {
    const detail = sanitizeFfmpegError(error);
    super(`FFmpeg could not initialize audio transcoding${detail ? `: ${detail}` : ''}`);
    this.name = 'FfmpegStartupError';
  }
}

const getFfmpegStartupError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  const isInvalidOutput = /Invalid data found when processing input/i.test(detail);
  const isNotFound = /(?:HTTP error|Server returned) (?:404|410)|404 Not Found|410 Gone/i.test(detail);
  const isForbidden = /(?:HTTP error|Server returned) 403|403 Forbidden/i.test(detail);

  if (isInvalidOutput) {
    return new FfmpegMediaUnavailableError(error, 'invalid-output');
  }

  if (isNotFound) {
    return new FfmpegMediaUnavailableError(error, 'not-found');
  }

  return new FfmpegStartupError(error, isForbidden);
};

type PlayerPlaybackAttemptContext = PlaybackAttemptContext<QueuedSong, VoiceConnection>;
export type PlayingMessageTerminalState = 'finished' | 'stopped' | 'disconnected';
type PlayingMessageUpdater = (terminalState?: PlayingMessageTerminalState) => Promise<void>;
type PlayingMessageState = {
  updater: PlayingMessageUpdater;
  id?: string;
  terminalState?: PlayingMessageTerminalState;
  updateInFlight: boolean;
  updateQueued: boolean;
  retired: boolean;
  keepAfterFinish: boolean;
  retryOnError: boolean;
  retryAttempts: number;
  retryTimer?: NodeJS.Timeout;
};

export default class {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  public readonly listeningSession?: ListeningSession;
  private currentChannel: VoiceChannel | undefined;
  private voiceConnectionGeneration = 0;
  private pendingConnection?: {channelId: string; promise: Promise<void>};
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private nowPlaying: QueuedSong | null = null;
  private currentQueueEntryVersion = 0;
  private nowPlayingQueueEntryVersion: number | null = null;
  private readonly playbackAttempts: PlaybackAttemptTracker<QueuedSong, VoiceConnection>;
  private readonly programmaticallyStoppedAudioPlayers = new WeakSet<AudioPlayer>();
  private playPositionInterval: NodeJS.Timeout | undefined;
  private playingMessage?: PlayingMessageState;
  private secondsSincePlayingMessageUpdate = 0;
  private readonly playingMessageUpdateIntervalSeconds: number;

  private positionInSeconds = 0;
  private readonly fileCache: FileCacheProvider;
  private readonly ageRestrictedFallbackResolver?: AgeRestrictedFallbackResolver;
  private disconnectTimer: NodeJS.Timeout | null = null;
  private prefetchedMedia?: {song: QueuedSong; fetchedAt: number; mediaSource: Promise<YtDlpMediaSource | null>};

  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private volumeBeforeVoiceActivity?: number;
  private voiceActivityVolumeTarget?: number;
  private voiceActivitySessionGeneration = 0;
  private hasRegisteredVoiceActivityListener = false;
  private readonly soundClips: SoundClips;
  private pendingIntro?: Promise<void>;
  private pendingLeave?: Promise<void>;
  private pendingLeaveReason: 'disconnected' | 'stopped' = 'disconnected';

  constructor(
    fileCache: FileCacheProvider,
    guildId: string,
    ageRestrictedFallbackResolver?: AgeRestrictedFallbackResolver,
    {
      playingMessageUpdateIntervalSeconds = DEFAULT_PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS,
      soundClips = {},
      listeningSession,
    }: {playingMessageUpdateIntervalSeconds?: number; soundClips?: SoundClips; listeningSession?: ListeningSession} = {},
  ) {
    this.soundClips = soundClips;
    this.listeningSession = listeningSession;
    this.fileCache = fileCache;
    this.guildId = guildId;
    this.ageRestrictedFallbackResolver = ageRestrictedFallbackResolver;
    this.playingMessageUpdateIntervalSeconds = playingMessageUpdateIntervalSeconds;
    this.playbackAttempts = new PlaybackAttemptTracker(() => ({
      currentSong: this.getCurrent(),
      queueEntryVersion: this.getCurrentQueueEntryId(),
      currentConnection: this.voiceConnection,
    }));
  }

  async connect(channel: VoiceChannel): Promise<void> {
    if (this.pendingConnection?.channelId === channel.id) {
      return this.pendingConnection.promise;
    }

    this.disconnect();
    const promise = this.connectWithRetries(channel, this.voiceConnectionGeneration);
    this.pendingConnection = {channelId: channel.id, promise};

    try {
      await promise;
    } finally {
      if (this.pendingConnection?.promise === promise) {
        this.pendingConnection = undefined;
      }
    }
  }

  /** Resolve known audio while an initial voice connection becomes ready. */
  prepareAudio(song: QueuedSong): void {
    if (song.source === MediaSource.HLS || song.isLive || this.prefetchedMedia) {
      return;
    }

    const generation = this.voiceConnectionGeneration;
    const mediaSource = (async () => {
      const to = song.offset === undefined ? undefined : song.length + song.offset;
      const cacheKey = this.getAudioCacheKey(song, to);
      const cachedEntry = await this.fileCache.getEntryFor(this.getHashForCache(cacheKey));
      if (cachedEntry || generation !== this.voiceConnectionGeneration) {
        return null;
      }

      return this.fetchMediaSource(song);
    })().catch((error: unknown) => {
      debug(`Audio preparation failed for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
      return null;
    });
    this.prefetchedMedia = {song, fetchedAt: Date.now(), mediaSource};
  }

  async ensureVoiceConnectionReady(): Promise<VoiceConnection> {
    // An initial join may replace a timed-out connection before it succeeds.
    if (this.pendingConnection) {
      await this.pendingConnection.promise;
    }

    const {voiceConnection} = this;
    if (voiceConnection === null) {
      throw new LocalizedError('player.error.notConnected');
    }

    await this.waitForVoiceConnectionReady(voiceConnection);
    if (this.voiceConnection !== voiceConnection) {
      throw new Error('Voice connection changed while waiting for it to become ready.');
    }

    return voiceConnection;
  }

  disconnect(reason: 'disconnected' | 'stopped' = 'disconnected'): void {
    this.voiceConnectionGeneration++;
    this.pendingConnection = undefined;
    this.prefetchedMedia = undefined;
    this.playbackAttempts.invalidate();
    this.voiceActivitySessionGeneration++;

    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      this.loopCurrentSong = false;
      destroyVoiceConnection(this.voiceConnection);
      this.stopAudioPlayer(true);

      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
      this.currentChannel = undefined;
      this.channelToSpeakingUsers.clear();
      this.volumeBeforeVoiceActivity = undefined;
      this.voiceActivityVolumeTarget = undefined;
      this.hasRegisteredVoiceActivityListener = false;
    }

    this.listeningSession?.finish(reason);
    if (this.playingMessage?.keepAfterFinish) {
      this.playingMessage.terminalState = reason;
      this.requestPlayingMessageUpdate();
    }
  }

  /**
   * Plays the configured outro (if any), then disconnects. Paused state and the queue
   * survive just as with disconnect(), and concurrent callers share one departure.
   * A stop during another caller's outro still ends the session as stopped.
   */
  async leave(reason: 'disconnected' | 'stopped' = 'disconnected'): Promise<void> {
    if (!this.pendingLeave || reason === 'stopped') {
      this.pendingLeaveReason = reason;
    }

    this.pendingLeave ??= (async () => {
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }

      this.playbackAttempts.invalidate();
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      if (this.soundClips.outro) {
        await this.playSoundClip(this.soundClips.outro, this.soundClips.outroVolume);
      }

      this.disconnect(this.pendingLeaveReason);
    })().finally(() => {
      this.pendingLeave = undefined;
    });

    return this.pendingLeave;
  }

  /** Lets a new request rejoin after an in-progress outro instead of racing it. */
  async waitForPendingLeave(): Promise<void> {
    await this.pendingLeave;
  }

  /**
   * Plays the configured intro (if any). Concurrent requests share one playthrough.
   * The upcoming song is resolved with yt-dlp while the intro plays, so it doesn't add load time.
   */
  async playIntro(): Promise<void> {
    if (!this.soundClips.intro) {
      return;
    }

    const upcoming = this.getCurrent();
    if (upcoming) {
      this.prefetchMedia(upcoming);
    }

    this.pendingIntro ??= this.playSoundClip(this.soundClips.intro, this.soundClips.introVolume).finally(() => {
      this.pendingIntro = undefined;
    });

    return this.pendingIntro;
  }

  async seek(positionSeconds: number, {preservePausedState = false} = {}): Promise<void> {
    const attempt = this.playbackAttempts.begin();
    const stayPaused = preservePausedState && this.status === STATUS.PAUSED;
    try {
      await this.seekWithAttempt(positionSeconds, attempt, stayPaused);
    } finally {
      this.requestPlayingMessageUpdate();
    }
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  /**
   * Registers the renderer for the live response created when /play starts a
   * playback session. Older responses can still finish their terminal edits.
   */
  setPlayingMessageUpdater(updater: PlayingMessageUpdater, messageId?: string, {keepAfterFinish = false, retryOnError = false} = {}): void {
    this.playingMessage = {
      updater,
      id: messageId,
      updateInFlight: false,
      updateQueued: false,
      retired: false,
      keepAfterFinish,
      retryOnError,
      retryAttempts: 0,
    };
    this.secondsSincePlayingMessageUpdate = 0;
  }

  /** Binds a published response only while its renderer still owns the session. */
  setPlayingMessageId(updater: PlayingMessageUpdater, messageId: string): boolean {
    const message = this.playingMessage;
    if (!message || message.updater !== updater
      || (message.terminalState !== undefined && !(message.keepAfterFinish && message.terminalState === 'finished'))) {
      return false;
    }

    message.id = messageId;
    return true;
  }

  /** Returns whether a reaction belongs to this player's current response. */
  isPlayingMessage(messageId: string): boolean {
    // Retire controls as soon as playback ends, even if the final edit is pending.
    return this.playingMessage?.terminalState === undefined && this.playingMessage?.id === messageId;
  }

  getPlayingMessageId(): string | undefined {
    return this.playingMessage?.retired ? undefined : this.playingMessage?.id;
  }

  /** Requests an immediate render after an externally initiated control. */
  refreshPlayingMessage(): void {
    this.requestPlayingMessageUpdate();
  }

  async play(allowAgeRestrictedFallback = true): Promise<void> {
    const attempt = this.playbackAttempts.begin();
    await this.playWithAttempt(attempt, allowAgeRestrictedFallback);
  }

  async replay(): Promise<void> {
    this.listeningSession?.endTrack('skipped');
    await this.seek(0);
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new LocalizedError('player.error.notPlaying');
    }

    this.playbackAttempts.invalidate();
    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();
    this.requestPlayingMessageUpdate();
  }

  async forward(skip: number): Promise<void> {
    const originalPosition = this.positionInSeconds;
    const originalQueuePosition = this.queuePosition;
    const originalSong = this.getCurrent();
    const originalQueueEntryVersion = this.currentQueueEntryVersion;
    this.manualForward(skip);
    const destinationSong = this.getCurrent();
    const destinationQueuePosition = this.queuePosition;
    const destinationQueueEntryVersion = this.currentQueueEntryVersion;
    let destinationPlayback: PlayerPlaybackAttemptContext | null = null;

    try {
      if (!destinationSong) {
        await this.finishQueue();
      } else if (this.status !== STATUS.PAUSED) {
        const playPromise = this.play();
        const destinationConnection = this.voiceConnection;
        if (destinationConnection && destinationSong && destinationQueueEntryVersion !== null) {
          destinationPlayback = this.playbackAttempts.capture(
            this.playbackAttempts.latest(),
            destinationSong,
            destinationQueueEntryVersion,
            destinationConnection,
          );
        }

        await playPromise;
      }
    } catch (error: unknown) {
      const canRestoreOriginalEntry = this.getCurrent() === destinationSong
        && this.queuePosition === destinationQueuePosition
        && this.queue[originalQueuePosition] === originalSong
        && this.currentQueueEntryVersion === destinationQueueEntryVersion
        && (destinationPlayback === null || this.playbackAttempts.owns(destinationPlayback));
      if (canRestoreOriginalEntry) {
        this.positionInSeconds = originalPosition;
        this.queuePosition = originalQueuePosition;
        this.currentQueueEntryVersion = originalQueueEntryVersion;
      }

      throw error;
    } finally {
      this.requestPlayingMessageUpdate();
    }
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {turnDownVolumeWhenPeopleSpeak, turnDownVolumeWhenPeopleSpeakTarget} = guildSettings;
    const {voiceConnection, currentChannel} = this;
    if (!turnDownVolumeWhenPeopleSpeak || !voiceConnection || !currentChannel) {
      return;
    }

    const voiceActivitySessionGeneration = ++this.voiceActivitySessionGeneration;
    const isCurrentVoiceActivitySession = () => (
      voiceActivitySessionGeneration === this.voiceActivitySessionGeneration
      && voiceConnection === this.voiceConnection
      && currentChannel === this.currentChannel
    );

    voiceConnection.receiver.speaking.on('start', (userId: string) => {
      if (!isCurrentVoiceActivitySession()) {
        return;
      }

      const member = currentChannel.members.get(userId);
      const {id: channelId} = currentChannel;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });

    voiceConnection.receiver.speaking.on('end', (userId: string) => {
      if (!isCurrentVoiceActivitySession()) {
        return;
      }

      this.channelToSpeakingUsers.get(currentChannel.id)?.delete(userId);

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget: number): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(this.currentChannel.id);
    if (speakingUsers && speakingUsers.size > 0) {
      if (this.volumeBeforeVoiceActivity === undefined) {
        this.volumeBeforeVoiceActivity = this.getVolume();
      }

      this.voiceActivityVolumeTarget = turnDownVolumeWhenPeopleSpeakTarget;
      this.setAudioPlayerVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else if (this.volumeBeforeVoiceActivity !== undefined) {
      const {volumeBeforeVoiceActivity} = this;
      this.volumeBeforeVoiceActivity = undefined;
      this.voiceActivityVolumeTarget = undefined;
      this.setAudioPlayerVolume(volumeBeforeVoiceActivity);
    }
  }

  canGoForward(skip: number) {
    return (this.queuePosition + skip - 1) < this.queue.length;
  }

  manualForward(skip: number): void {
    if (this.canGoForward(skip)) {
      this.listeningSession?.endTrack('skipped');
      this.queuePosition += skip;
      this.currentQueueEntryVersion++;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
    } else {
      throw new LocalizedError('player.error.noNextSong');
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (!this.canGoBack()) {
      throw new LocalizedError('player.error.noPreviousSong');
    }

    this.listeningSession?.endTrack('skipped');

    const originalPosition = this.positionInSeconds;
    const originalQueuePosition = this.queuePosition;
    const originalSong = this.getCurrent();
    const originalQueueEntryVersion = this.currentQueueEntryVersion;
    this.queuePosition--;
    this.currentQueueEntryVersion++;
    this.positionInSeconds = 0;
    this.stopTrackingPosition();
    const destinationSong = this.getCurrent();
    const destinationQueuePosition = this.queuePosition;
    const destinationQueueEntryVersion = this.currentQueueEntryVersion;
    let destinationPlayback: PlayerPlaybackAttemptContext | null = null;

    try {
      if (this.status !== STATUS.PAUSED) {
        const playPromise = this.play();
        const destinationConnection = this.voiceConnection;
        if (destinationConnection && destinationSong) {
          destinationPlayback = this.playbackAttempts.capture(
            this.playbackAttempts.latest(),
            destinationSong,
            destinationQueueEntryVersion,
            destinationConnection,
          );
        }

        await playPromise;
      }
    } catch (error: unknown) {
      const canRestoreOriginalEntry = this.getCurrent() === destinationSong
        && this.queuePosition === destinationQueuePosition
        && this.queue[originalQueuePosition] === originalSong
        && this.currentQueueEntryVersion === destinationQueueEntryVersion
        && (destinationPlayback === null || this.playbackAttempts.owns(destinationPlayback));
      if (canRestoreOriginalEntry) {
        this.positionInSeconds = originalPosition;
        this.queuePosition = originalQueuePosition;
        this.currentQueueEntryVersion = originalQueueEntryVersion;
      }

      throw error;
    } finally {
      this.requestPlayingMessageUpdate();
    }
  }

  getCurrent(): QueuedSong | null {
    if (this.queue[this.queuePosition]) {
      return this.queue[this.queuePosition];
    }

    return null;
  }

  getCurrentQueueEntryId(): number | null {
    return this.getCurrent() === null ? null : this.currentQueueEntryVersion;
  }

  /**
   * Returns queue, not including the current song.
   * @returns {QueuedSong[]}
   */
  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, {immediate = false, immediateOffset = 0} = {}): void {
    const currentSong = this.getCurrent();

    if (immediate) {
      // Add as the next song to be played
      const insertAt = this.queuePosition + immediateOffset + 1;
      this.queue = [...this.queue.slice(0, insertAt), song, ...this.queue.slice(insertAt)];
    } else {
      // Add to end of queue
      this.queue.push(song);
    }

    if (this.getCurrent() !== currentSong) {
      this.currentQueueEntryVersion++;
    }

    this.requestPlayingMessageUpdate();
  }

  shuffle(): void {
    const historyAndCurrent = this.queue.slice(0, this.queuePosition + 1);
    const shuffledSongs = shuffle(uniqueSongs(this.getQueue(), historyAndCurrent));

    this.queue = [...historyAndCurrent, ...shuffledSongs];
    this.requestPlayingMessageUpdate();
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
    this.requestPlayingMessageUpdate();
  }

  removeFromQueue(index: number, amount = 1): void {
    this.queue.splice(this.queuePosition + index, amount);
    this.requestPlayingMessageUpdate();
  }

  removeCurrent(): void {
    this.listeningSession?.endTrack('skipped');
    this.queue = [...this.queue.slice(0, this.queuePosition), ...this.queue.slice(this.queuePosition + 1)];
    this.currentQueueEntryVersion++;
    this.requestPlayingMessageUpdate();
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  async stop(): Promise<void> {
    // Without an outro, leave() disconnects before returning its promise.
    const leaving = this.leave('stopped');
    this.queuePosition = 0;
    this.queue = [];
    this.currentQueueEntryVersion++;
    // Serialize a terminal edit behind any progress edit already in flight.
    if (this.playingMessage) {
      this.playingMessage.terminalState = 'stopped';
    }

    this.requestPlayingMessageUpdate();
    await leaving;
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new LocalizedError('player.error.moveOutOfRange');
    }

    this.queue.splice(this.queuePosition + to, 0, this.queue.splice(this.queuePosition + from, 1)[0]);
    this.requestPlayingMessageUpdate();

    return this.queue[this.queuePosition + to];
  }

  setVolume(level: number): void {
    // Level should be a number between 0 and 100 = 0% => 100%
    this.volume = level;

    if (this.volumeBeforeVoiceActivity === undefined) {
      this.setAudioPlayerVolume(level);
    } else {
      this.volumeBeforeVoiceActivity = level;
      this.setAudioPlayerVolume(this.voiceActivityVolumeTarget);
    }

    this.requestPlayingMessageUpdate();
  }

  getVolume(): number {
    // Only use default volume if player volume is not already set (in the event of a reconnect we shouldn't reset)
    return this.voiceActivityVolumeTarget ?? this.volume ?? this.defaultVolume;
  }

  private async connectWithRetries(channel: VoiceChannel, generation: number): Promise<void> {
    const settings = await getGuildSettings(this.guildId);
    if (generation !== this.voiceConnectionGeneration) {
      throw new Error('Voice connection attempt was cancelled.');
    }

    this.defaultVolume = settings.defaultVolume ?? DEFAULT_VOLUME;

    for (let attempt = 1; attempt <= VOICE_CONNECTION_ATTEMPTS; attempt++) {
      const voiceConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        selfDeaf: false,
        adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      });

      this.voiceConnection = voiceConnection;
      this.currentChannel = channel;
      this.hasRegisteredVoiceActivityListener = false;

      voiceConnection.on('error', error => {
        console.error(`Voice connection error for guild ${this.guildId}:`, error);
      });

      const stateTransitions = [voiceConnection.state.status];
      voiceConnection.on('stateChange', (oldState, newState) => {
        stateTransitions.push(newState.status);
        if (stateTransitions.length > 10) {
          stateTransitions.shift();
        }

        debug(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);

        if (this.voiceConnection === voiceConnection
          && newState.status === VoiceConnectionStatus.Ready
          && !this.hasRegisteredVoiceActivityListener) {
          this.registerVoiceActivityListener(settings);
          this.hasRegisteredVoiceActivityListener = true;
        }
      });

      voiceConnection.on(
        VoiceConnectionStatus.Disconnected,
        this.onVoiceConnectionDisconnect.bind(this, voiceConnection),
      );

      try {
        // Handshakes must run sequentially so only one connection owns the guild.
        // eslint-disable-next-line no-await-in-loop
        await entersState(voiceConnection, VoiceConnectionStatus.Ready, VOICE_CONNECTION_ATTEMPT_TIMEOUT_MS);
        if (generation !== this.voiceConnectionGeneration || this.voiceConnection !== voiceConnection) {
          throw new Error('Voice connection attempt was cancelled.');
        }

        return;
      } catch {
        const {state, rejoinAttempts} = voiceConnection;
        const networking = 'networking' in state ? state.networking : undefined;
        // Only log the enum, never the networking object: it contains voice credentials.
        const networkState = networking ? NetworkingStatusCode[networking.state.code] : 'unavailable';
        const diagnostics = `last state: ${state.status}, network state: ${networkState}, attempt: ${attempt}/${VOICE_CONNECTION_ATTEMPTS}, rejoin attempts: ${rejoinAttempts}, recent states: ${stateTransitions.join(' -> ')}`;
        const shouldRetry = generation === this.voiceConnectionGeneration
          && this.voiceConnection === voiceConnection
          && (state.status === VoiceConnectionStatus.Connecting || state.status === VoiceConnectionStatus.Signalling)
          && attempt < VOICE_CONNECTION_ATTEMPTS;

        destroyVoiceConnection(voiceConnection);
        if (this.voiceConnection === voiceConnection) {
          this.voiceConnection = null;
          this.currentChannel = undefined;
          this.hasRegisteredVoiceActivityListener = false;
        }

        if (!shouldRetry) {
          throw new LocalizedError('player.error.connectFailed', {details: diagnostics});
        }

        // A fresh join requests new voice-server/session data; rejoin alone can reuse a stalled handshake.
        console.warn(`Retrying voice connection for guild ${this.guildId} (${diagnostics}).`);
      }
    }
  }

  private async seekWithAttempt(positionSeconds: number, attempt: PlaybackAttemptToken, stayPaused = false): Promise<void> {
    this.status = STATUS.PAUSED;

    const currentSong = this.getCurrent();
    const currentQueueEntryVersion = this.getCurrentQueueEntryId();
    const voiceConnection = await this.ensureVoiceConnectionReady();

    if (!this.playbackAttempts.isCurrent(attempt, voiceConnection)) {
      return;
    }

    if (!currentSong) {
      throw new LocalizedError('player.error.noCurrentSong');
    }

    if (currentQueueEntryVersion === null) {
      return;
    }

    const playback = this.playbackAttempts.capture(
      attempt,
      currentSong,
      currentQueueEntryVersion,
      voiceConnection,
    );
    if (!this.playbackAttempts.owns(playback)) {
      return;
    }

    if (positionSeconds > currentSong.length) {
      throw new LocalizedError('player.error.seekOutOfRange');
    }

    if (stayPaused) {
      // A buffering AudioPlayer cannot be paused. Keep only the new resume
      // position and let play() recreate the resource when playback is wanted.
      // Ownership was checked above, before retiring the current resource.
      this.stopTrackingPosition();
      this.stopAudioPlayer(true);
      this.audioPlayer = null;
      this.audioResource = null;
      this.positionInSeconds = positionSeconds;
      this.nowPlaying = currentSong;
      this.nowPlayingQueueEntryVersion = currentQueueEntryVersion;
      return;
    }

    let realPositionSeconds = positionSeconds;
    let to: number | undefined;
    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
      to = currentSong.length + currentSong.offset;
    }

    const previousPosition = this.positionInSeconds;
    this.stopTrackingPosition();
    let stream: Readable | null;
    try {
      stream = await this.getStream(currentSong, {seek: realPositionSeconds, to}, playback);
    } catch (error: unknown) {
      if (this.playbackAttempts.owns(playback)) {
        this.positionInSeconds = previousPosition;
        this.audioPlayer = null;
        this.audioResource = null;
      }

      await this.handlePlaybackError(error, playback, true);
      return;
    }

    if (!stream) {
      return;
    }

    if (!this.playbackAttempts.owns(playback)) {
      this.destroyStaleStream(stream);
      return;
    }

    this.audioPlayer = createAudioPlayer({
      behaviors: {
        // Needs to be somewhat high for livestreams
        maxMissedFrames: 50,
      },
    });
    voiceConnection.subscribe(this.audioPlayer);
    this.attachListeners();
    this.playAudioPlayerResource(this.createAudioStream(stream));
    this.startTrackingPosition(positionSeconds);

    this.status = STATUS.PLAYING;
    this.nowPlaying = currentSong;
    this.nowPlayingQueueEntryVersion = currentQueueEntryVersion;
  }

  private async playWithAttempt(attempt: PlaybackAttemptToken, allowAgeRestrictedFallback: boolean): Promise<void> {
    const currentSong = this.getCurrent();
    const currentQueueEntryVersion = this.getCurrentQueueEntryId();
    const voiceConnection = await this.ensureVoiceConnectionReady();

    if (!this.playbackAttempts.isCurrent(attempt, voiceConnection)) {
      return;
    }

    if (!currentSong) {
      throw new LocalizedError('player.error.queueEmpty');
    }

    if (currentQueueEntryVersion === null) {
      return;
    }

    const playback = this.playbackAttempts.capture(
      attempt,
      currentSong,
      currentQueueEntryVersion,
      voiceConnection,
    );
    if (!this.playbackAttempts.owns(playback)) {
      return;
    }

    // Cancel any pending idle disconnection
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Resume from paused state
    if (this.status === STATUS.PAUSED
      && currentSong === this.nowPlaying
      && this.currentQueueEntryVersion === this.nowPlayingQueueEntryVersion) {
      if (this.audioPlayer) {
        this.audioPlayer.unpause();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        return;
      }

      // Was disconnected, need to recreate stream
      if (!currentSong.isLive) {
        return this.seekWithAttempt(this.getPosition(), attempt);
      }
    }

    const previousPosition = this.positionInSeconds;
    this.stopTrackingPosition();
    try {
      let positionSeconds: number | undefined;
      let to: number | undefined;
      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
        to = currentSong.length + currentSong.offset;
      }

      const stream = await this.getStream(currentSong, {seek: positionSeconds, to}, playback);
      if (!stream) {
        return;
      }

      if (!this.playbackAttempts.owns(playback)) {
        this.destroyStaleStream(stream);
        return;
      }

      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // Needs to be somewhat high for livestreams
          maxMissedFrames: 50,
        },
      });
      voiceConnection.subscribe(this.audioPlayer);
      this.attachListeners();
      this.playAudioPlayerResource(this.createAudioStream(stream));

      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;
      this.nowPlayingQueueEntryVersion = currentQueueEntryVersion;
      this.startTrackingPosition(0);
    } catch (error: unknown) {
      if (this.playbackAttempts.owns(playback)) {
        this.positionInSeconds = previousPosition;
        this.status = STATUS.PAUSED;
        this.audioPlayer = null;
        this.audioResource = null;
      }

      await this.handlePlaybackError(
        error,
        playback,
        allowAgeRestrictedFallback,
      );
    }
  }

  private async handlePlaybackError(
    error: unknown,
    playback: PlayerPlaybackAttemptContext,
    allowAgeRestrictedFallback: boolean,
  ): Promise<void> {
    if (!this.playbackAttempts.owns(playback)) {
      throw error;
    }

    const isGone = typeof error === 'object'
      && error !== null
      && 'statusCode' in error
      && error.statusCode === 410;

    if (error instanceof YtDlpMediaUnavailableError
      && error.reason === 'age-restricted'
      && allowAgeRestrictedFallback) {
      const fallbackHandled = await this.tryAgeRestrictedAudioFallback(playback);
      if (fallbackHandled) {
        return;
      }

      if (!this.playbackAttempts.owns(playback)) {
        throw error;
      }
    }

    if (error instanceof YtDlpMediaUnavailableError
      || error instanceof FfmpegMediaUnavailableError
      || isGone) {
      const detail = error instanceof Error ? error.message : 'media returned HTTP 410';
      console.warn(`Skipping unplayable track for guild ${this.guildId} (${getMediaIdentifierForLog(playback.song)}): ${detail}`);
      await this.advancePastUnplayableTrack();
      return;
    }

    throw error;
  }

  private getHashForCache(url: string): string {
    return hasha(url);
  }

  private getAudioCacheKey(song: QueuedSong, to?: number): string {
    // Cached audio starts at zero but may end at a chapter or SponsorBlock boundary.
    // Version the key to avoid reusing legacy URL-only entries with unknown bounds.
    return JSON.stringify(['audio-v2', song.source, song.url, to ?? null]);
  }

  private async getStream(
    song: QueuedSong,
    options: {seek?: number; to?: number} = {},
    playback?: PlayerPlaybackAttemptContext,
  ): Promise<Readable | null> {
    if (playback && !this.playbackAttempts.owns(playback)) {
      return null;
    }

    if (this.status === STATUS.PLAYING) {
      this.stopAudioPlayer();
    } else if (this.status === STATUS.PAUSED) {
      this.stopAudioPlayer(true);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({url: song.url, cacheKey: song.url});
    }

    return this.getCachedOrRemoteStream(song, options, playback);
  }

  private async getCachedOrRemoteStream(
    song: QueuedSong,
    options: {seek?: number; to?: number},
    playback?: PlayerPlaybackAttemptContext,
  ): Promise<Readable | null> {
    const isCurrent = () => !playback || this.playbackAttempts.owns(playback);
    let ffmpegInput: string | null;
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    const cacheKey = this.getAudioCacheKey(song, options.to);
    const cacheHash = this.getHashForCache(cacheKey);
    const cachedEntry = await this.fileCache.getEntryFor(cacheHash);
    if (!isCurrent()) {
      return null;
    }

    ffmpegInput = cachedEntry?.path ?? null;

    if (!ffmpegInput) {
      let mediaSource = await this.takePrefetchedMediaSource(song);
      if (!isCurrent()) {
        return null;
      }

      mediaSource ??= await this.fetchMediaSource(song);
      if (!isCurrent()) {
        return null;
      }

      ffmpegInput = mediaSource.url;

      // Don't cache livestreams or long videos
      const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes
      shouldCacheVideo = !mediaSource.isLive && song.length < MAX_CACHE_LENGTH_SECONDS && !options.seek;

      debug(shouldCacheVideo ? 'Caching video' : 'Not caching video');

      ffmpegInputOptions.push(...[
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
      ]);

      const headerOptions = this.buildFfmpegHeaderOptions(mediaSource.headers);
      ffmpegInputOptions.push(...headerOptions);

      await this.waitForMediaAvailability(mediaSource.availableAt);
    }

    if (!isCurrent()) {
      return null;
    }

    if (options.seek) {
      ffmpegInputOptions.push('-ss', options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push('-to', options.to.toString());
    }

    const readStreamOptions = {
      url: ffmpegInput,
      cacheKey,
      ffmpegInputOptions,
      cache: shouldCacheVideo,
    };

    try {
      return await (cachedEntry
        ? this.createReadStream(readStreamOptions)
        : this.createRemoteReadStream(readStreamOptions, isCurrent));
    } catch (error: unknown) {
      if (!isCurrent()) {
        return null;
      }

      if (cachedEntry
        && error instanceof FfmpegMediaUnavailableError
        && error.reason === 'invalid-output') {
        await this.fileCache.invalidate(cacheHash, cachedEntry.generation);
        return this.getStream(song, options, playback);
      }

      throw error;
    }
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
      this.secondsSincePlayingMessageUpdate++;
      // Reuse the playback clock so paused and idle time never trigger edits.
      if (this.secondsSincePlayingMessageUpdate >= this.playingMessageUpdateIntervalSeconds) {
        this.secondsSincePlayingMessageUpdate = 0;
        this.requestPlayingMessageUpdate();
      }

      this.prefetchNextSongIfDue();
    }, 1000);
  }

  private recordStartedTrack(song: QueuedSong, queueEntryId: number, connection: VoiceConnection): void {
    this.listeningSession?.startTrack(song, connection.joinConfig.channelId!, queueEntryId);
    if (this.playingMessage?.keepAfterFinish && this.playingMessage.terminalState === 'finished') {
      this.playingMessage.terminalState = undefined;
    }
  }

  /**
   * Serializes edits for each response. Replaced responses may finish their
   * terminal update, but must not render progress from the new session.
   */
  private requestPlayingMessageUpdate(message = this.playingMessage): void {
    if (!message || message.retired
      || (message !== this.playingMessage && message.terminalState === undefined)) {
      return;
    }

    if (message === this.playingMessage) {
      this.secondsSincePlayingMessageUpdate = 0;
    }

    if (message.updateInFlight) {
      message.updateQueued = true;
      return;
    }

    clearTimeout(message.retryTimer);
    message.retryTimer = undefined;
    message.updateInFlight = true;
    const {terminalState} = message;
    void message.updater(terminalState)
      .then(() => {
        message.retryAttempts = 0;
        if (terminalState && message.terminalState === terminalState
          && !(terminalState === 'finished' && message.keepAfterFinish)) {
          // Terminal responses no longer receive timer edits or controls.
          message.retired = true;
          if (this.playingMessage === message) {
            this.playingMessage = undefined;
          }
        }
      })
      .catch((error: unknown) => {
        if (message.retryOnError) {
          // Public history can fail independently of the primary card. Keep
          // its renderer, including a stopped session's final recap. Bound
          // automatic retries; ordinary progress/control updates can retry too.
          if (message.retryAttempts < 3) {
            message.retryAttempts++;
            message.retryTimer = setTimeout(() => {
              this.requestPlayingMessageUpdate(message);
            }, 3000);
            message.retryTimer.unref();
          }
        } else {
          // A failed old response must not retire the new session's response.
          message.retired = true;
          if (this.playingMessage === message) {
            this.playingMessage = undefined;
          }
        }

        const detail = error instanceof Error ? `${error.name}: ${error.message}` : error;
        console.warn(`Could not update playing message for guild ${this.guildId}: ${sanitizeFfmpegError(detail)}`);
      })
      .finally(() => {
        message.updateInFlight = false;
        if (message.updateQueued) {
          message.updateQueued = false;
          // A failed render's scheduled retry reads the latest state. Avoid
          // bypassing its delay when Stop queued the same terminal edit twice.
          if (!message.retryTimer) {
            this.requestPlayingMessageUpdate(message);
          }
        }
      });
  }

  private async fetchMediaSource(song: QueuedSong): Promise<YtDlpMediaSource> {
    return song.source === MediaSource.SoundCloud
      ? getSoundCloudMediaSource(song.url)
      : getYouTubeMediaSource(song.url);
  }

  // Resolving early lets any yt-dlp available_at wait elapse while the current song plays.
  private prefetchNextSongIfDue(): void {
    const current = this.getCurrent();
    const next = this.queue[this.queuePosition + 1];
    if (!current || !next || this.loopCurrentSong || this.prefetchedMedia?.song === next) {
      return;
    }

    if (current.length - this.positionInSeconds > PREFETCH_LEAD_SECONDS) {
      return;
    }

    this.prefetchMedia(next);
  }

  /** Starts yt-dlp resolving a song in the background; getCachedOrRemoteStream() picks up the result. */
  private prefetchMedia(song: QueuedSong): void {
    if (song.source === MediaSource.HLS || song.isLive || this.prefetchedMedia?.song === song) {
      return;
    }

    const mediaSource = this.fetchMediaSource(song).catch((error: unknown) => {
      debug(`Prefetch failed for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
      return null;
    });
    this.prefetchedMedia = {song, fetchedAt: Date.now(), mediaSource};
  }

  private async takePrefetchedMediaSource(song: QueuedSong): Promise<YtDlpMediaSource | null> {
    const prefetched = this.prefetchedMedia;
    if (!prefetched || prefetched.song !== song) {
      return null;
    }

    this.prefetchedMedia = undefined;
    const mediaSource = await prefetched.mediaSource;

    return Date.now() - prefetched.fetchedAt <= PREFETCH_MAX_AGE_MS ? mediaSource : null;
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
      this.playPositionInterval = undefined;
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (!this.audioPlayer) {
      return;
    }

    const {audioPlayer, voiceConnection} = this;
    if (audioPlayer.listeners('error').length === 0) {
      audioPlayer.on('error', error => {
        // The voice library transitions failed resources to Idle after emitting
        // this event. Let the existing Idle handler advance the queue once.
        console.error(`Audio player failed for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
      });
    }

    const queueEntryVersion = this.currentQueueEntryVersion;
    const song = this.getCurrent();
    if (this.listeningSession && song) {
      this.listeningSession.prepare(voiceConnection.joinConfig.channelId!, song.addedInChannelId);
      audioPlayer.on(AudioPlayerStatus.Playing, (_oldState, newState) => {
        // Playback may only enter Buffering. Count the owned resource once it
        // actually plays, and ignore late events from stopped/replaced audio.
        if (this.programmaticallyStoppedAudioPlayers.has(audioPlayer)
          || this.audioPlayer !== audioPlayer || this.voiceConnection !== voiceConnection
          || this.currentQueueEntryVersion !== queueEntryVersion || this.getCurrent() !== song
          || newState.resource !== this.audioResource) {
          return;
        }

        this.recordStartedTrack(song, queueEntryVersion, voiceConnection);
        this.requestPlayingMessageUpdate();
      });
    }

    if (audioPlayer.listeners(AudioPlayerStatus.Idle).length === 0) {
      audioPlayer.on(AudioPlayerStatus.Idle, (oldState, newState) => {
        if (this.programmaticallyStoppedAudioPlayers.has(audioPlayer)
          || this.audioPlayer !== audioPlayer
          || this.currentQueueEntryVersion !== queueEntryVersion) {
          return;
        }

        void this.onAudioPlayerIdle(oldState, newState).catch(error => {
          console.error(`Audio player idle handler failed for guild ${this.guildId}:`, error);
        });
      });
    }
  }

  private async onVoiceConnectionDisconnect(voiceConnection: VoiceConnection): Promise<void> {
    await recoverVoiceConnection(voiceConnection, {
      isCurrent: candidate => this.voiceConnection === candidate,
      dispose: candidate => {
        if (this.voiceConnection === candidate) {
          this.disconnect();
        } else {
          destroyVoiceConnection(candidate);
        }
      },
    });
  }

  private async waitForVoiceConnectionReady(voiceConnection: VoiceConnection): Promise<void> {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 60_000);
  }

  private async advancePastUnplayableTrack(): Promise<void> {
    this.manualForward(1);

    if (!this.getCurrent()) {
      await this.finishQueue();
      return;
    }

    await this.play();
  }

  private async tryAgeRestrictedAudioFallback(playback: PlayerPlaybackAttemptContext): Promise<boolean> {
    const {song, queueEntryVersion, attempt, connection} = playback;
    if (!this.ageRestrictedFallbackResolver || song.source !== MediaSource.Youtube) {
      return false;
    }

    if (!this.playbackAttempts.owns(playback)) {
      return true;
    }

    let fallback: SongMetadata | null;
    try {
      fallback = await this.ageRestrictedFallbackResolver(song);
    } catch {
      if (!this.playbackAttempts.owns(playback)) {
        return true;
      }

      console.warn(`Audio fallback search failed for age-restricted track in guild ${this.guildId}.`);
      return false;
    }

    if (!this.playbackAttempts.owns(playback)) {
      return true;
    }

    if (!fallback || fallback.source !== MediaSource.Youtube || fallback.url === song.url) {
      return false;
    }

    const {queuePosition} = this;
    const replacement: QueuedSong = {
      ...fallback,
      playlist: song.playlist,
      addedInChannelId: song.addedInChannelId,
      requestedBy: song.requestedBy,
    };
    this.queue[queuePosition] = replacement;
    const replacementPlayback = this.playbackAttempts.capture(
      attempt,
      replacement,
      queueEntryVersion,
      connection,
    );
    console.warn(`Trying audio fallback for age-restricted YouTube track in guild ${this.guildId}: ${song.url} -> ${replacement.url}`);

    try {
      await this.playWithAttempt(attempt, false);
      return true;
    } catch (error: unknown) {
      if (this.playbackAttempts.owns(replacementPlayback)
        && this.queue[queuePosition] === replacement) {
        this.queue[queuePosition] = song;
      }

      throw error;
    }
  }

  private async onAudioPlayerIdle(_oldState: AudioPlayerState, newState: AudioPlayerState): Promise<void> {
    if (newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      this.listeningSession?.endTrack('completed');
    }

    // Automatically advance queued song at end
    if (this.loopCurrentSong && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      await this.seek(0);
      return;
    }

    // Automatically re-add current song to queue
    if (this.loopCurrentQueue && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        throw new Error('No song currently playing.');
      }
    }

    if (newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      if (!this.canGoForward(1)) {
        await this.finishQueue();
        return;
      }

      await this.forward(1);
      const currentSong = this.getCurrent();
      if (!currentSong) {
        return;
      }

      // Auto announce the next song if configured to
      const settings = await getGuildSettings(this.guildId);
      const {autoAnnounceNextSong} = settings;
      if (autoAnnounceNextSong && this.currentChannel) {
        await this.currentChannel.send({
          embeds: [buildPlayingMessageEmbed(this, this.currentChannel.guild.preferredLocale)],
        });
      }
    }
  }

  private async finishQueue(): Promise<void> {
    this.playbackAttempts.invalidate();
    this.stopTrackingPosition();
    this.status = STATUS.IDLE;
    this.stopAudioPlayer(true);
    // Let the response restore its original acknowledgment after the queue empties.
    if (this.playingMessage) {
      this.playingMessage.terminalState = 'finished';
    }

    this.requestPlayingMessageUpdate();

    const settings = await getGuildSettings(this.guildId);

    const {secondsToWaitAfterQueueEmpties} = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        // Make sure we are not accidentally playing
        // when disconnecting
        if (this.status === STATUS.IDLE) {
          void this.leave().catch(error => {
            console.error(`Leaving idle voice channel failed for guild ${this.guildId}:`, error);
          });
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  private buildFfmpegHeaderOptions(headers: Record<string, string>) {
    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    if (!headerLines) {
      return [];
    }

    return ['-headers', `${headerLines}\r\n`];
  }

  private async waitForMediaAvailability(availableAt?: number) {
    if (typeof availableAt !== 'number' || !Number.isFinite(availableAt)) {
      return;
    }

    // The available_at value has one-second resolution, so pad by a second to avoid an early request.
    const waitMs = Math.min((availableAt * 1000) + 1000 - Date.now(), MAX_MEDIA_AVAILABILITY_WAIT_MS);
    if (waitMs <= 0) {
      return;
    }

    console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for media to become available for guild ${this.guildId}, as required by the site.`);
    await sleep(waitMs);
  }

  private async createRemoteReadStream(
    options: {url: string; cacheKey: string; ffmpegInputOptions?: string[]; cache?: boolean},
    isCurrent: () => boolean,
  ): Promise<Readable | null> {
    for (const delayMs of MEDIA_FORBIDDEN_RETRY_DELAYS_MS) {
      // Stop, seek, or a newer play request can retire this attempt during a wait.
      if (!isCurrent()) {
        return null;
      }

      try {
        // Retries must run sequentially so each one follows the wait.
        // eslint-disable-next-line no-await-in-loop
        return await this.createReadStream(options);
      } catch (error: unknown) {
        if (!isCurrent()) {
          return null;
        }

        if (!(error instanceof FfmpegStartupError && error.forbidden)) {
          throw error;
        }

        console.warn(`Media URL returned 403 Forbidden for guild ${this.guildId}, retrying in ${delayMs / 1000}s.`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(delayMs);
      }
    }

    return isCurrent() ? this.createReadStream(options) : null;
  }

  private async createReadStream(options: {url: string; cacheKey: string; ffmpegInputOptions?: string[]; cache?: boolean}): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const capacitor = new WriteStream();
      const startupProbeStream = capacitor.createReadStream();
      const opusProbe = new prismMedia.opus.WebmDemuxer();
      let cacheReadStream: Readable | undefined;
      let cacheWriteStream: ReturnType<FileCacheProvider['createWriteStream']> | undefined;

      if (options?.cache) {
        cacheWriteStream = this.fileCache.createWriteStream(this.getHashForCache(options.cacheKey));
        cacheReadStream = capacitor.createReadStream();
        cacheReadStream.pipe(cacheWriteStream, {end: false});
      }

      const returnedStream = capacitor.createReadStream();
      let cacheWriteAborted = false;
      let cacheReadEnded = false;
      let ffmpegEnded = false;
      let hasReturnedStreamClosed = false;
      let startupSettled = false;
      let startupTimedOut = false;
      let startupTimeout: NodeJS.Timeout | undefined;

      const cleanupStartupListeners = () => {
        if (startupTimeout) {
          clearTimeout(startupTimeout);
          startupTimeout = undefined;
        }

        opusProbe.off('data', onPlayablePacket);
        startupProbeStream.off('end', onEndBeforePlayablePacket);
      };

      const destroyCacheWrite = () => {
        if (cacheWriteAborted) {
          return;
        }

        cacheWriteAborted = true;
        cacheReadStream?.destroy();
        cacheWriteStream?.destroy();
      };

      const finalizeCacheWriteIfComplete = () => {
        if (!cacheWriteAborted
          && cacheReadEnded
          && ffmpegEnded
          && cacheWriteStream
          && !cacheWriteStream.writableEnded) {
          cacheWriteStream.end();
        }
      };

      const rejectStartup = (error: unknown) => {
        if (startupSettled) {
          return;
        }

        startupSettled = true;
        cleanupStartupListeners();
        destroyCacheWrite();
        startupProbeStream.destroy();
        opusProbe.destroy();
        returnedStream.destroy();
        capacitor.destroy();
        reject(error instanceof FfmpegMediaUnavailableError || error instanceof FfmpegStartupError
          ? error
          : new FfmpegStartupError(error));
      };

      const onPlayablePacket = () => {
        if (startupSettled) {
          return;
        }

        startupSettled = true;
        cleanupStartupListeners();
        startupProbeStream.destroy();
        opusProbe.destroy();
        resolve(returnedStream);
      };

      const onEndBeforePlayablePacket = () => {
        if (ffmpegEnded) {
          rejectStartup(new FfmpegMediaUnavailableError(
            new Error('FFmpeg produced no playable Opus audio.'),
            'invalid-output',
          ));
        }
      };

      const onFfmpegEnd = () => {
        ffmpegEnded = true;
        finalizeCacheWriteIfComplete();
        if (startupProbeStream.readableEnded) {
          onEndBeforePlayablePacket();
        }
      };

      const onBufferError = (error: unknown) => {
        if (!startupSettled) {
          rejectStartup(new FfmpegStartupError(error));
          return;
        }

        console.error(`Playback buffer failed after playback began for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
        destroyCacheWrite();
      };

      const onCacheWriteError = (error: unknown) => {
        console.warn(`Disabling cache write for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
        destroyCacheWrite();
      };

      const stream = ffmpeg(options.url)
        .inputOptions(options?.ffmpegInputOptions ?? ['-re'])
        .noVideo()
        .audioCodec('libopus')
        .outputFormat('webm')
        .on('error', error => {
          destroyCacheWrite();

          if (hasReturnedStreamClosed) {
            return;
          }

          if (!startupSettled) {
            rejectStartup(getFfmpegStartupError(error));
            return;
          }

          console.error(`FFmpeg stream failed after playback began for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
          if (!capacitor.writableEnded) {
            capacitor.end();
          }
        })
        .on('start', () => {
          if (startupTimedOut) {
            stream.kill('SIGKILL');
            return;
          }

          debug('Spawned ffmpeg for playback');
        })
        .on('end', onFfmpegEnd);

      capacitor.on('error', onBufferError);
      startupProbeStream.on('error', onBufferError);
      returnedStream.on('error', onBufferError);
      opusProbe.on('error', onBufferError);
      cacheReadStream?.on('error', onCacheWriteError);
      cacheReadStream?.once('end', () => {
        cacheReadEnded = true;
        finalizeCacheWriteIfComplete();
      });
      cacheWriteStream?.on('error', onCacheWriteError);
      opusProbe.once('data', onPlayablePacket);
      startupProbeStream.once('end', onEndBeforePlayablePacket);
      startupProbeStream.pipe(opusProbe);
      startupTimeout = setTimeout(() => {
        startupTimedOut = true;
        stream.kill('SIGKILL');
        rejectStartup(new FfmpegStartupError(
          new Error(`FFmpeg produced no playable audio within ${FFMPEG_STARTUP_TIMEOUT_MS / 1000} seconds.`),
        ));
      }, FFMPEG_STARTUP_TIMEOUT_MS);

      stream.pipe(capacitor);

      returnedStream.on('close', () => {
        if (!options.cache) {
          stream.kill('SIGKILL');
        }

        hasReturnedStreamClosed = true;
      });
    });
  }

  /** Plays a local audio file on its own player. Failures are logged, never thrown. */
  private async playSoundClip(filePath: string, volumePercent = 100): Promise<void> {
    const {voiceConnection} = this;
    if (voiceConnection?.state.status !== VoiceConnectionStatus.Ready) {
      return;
    }

    // Stop as soon as the connection drops or another player takes it over.
    const clipPlayer = createAudioPlayer({behaviors: {noSubscriber: NoSubscriberBehavior.Stop}});
    clipPlayer.on('error', error => {
      console.warn(`Sound clip failed for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
    });
    const subscription = voiceConnection.subscribe(clipPlayer);
    let resource: AudioResource | undefined;

    try {
      resource = createAudioResource(filePath, {inlineVolume: true});
      resource.volume?.setVolume((this.getVolume() / 100) * (volumePercent / 100));
      clipPlayer.play(resource);
      await entersState(clipPlayer, AudioPlayerStatus.Idle, MAX_SOUND_CLIP_MS);
    } catch (error: unknown) {
      console.warn(`Sound clip did not finish for guild ${this.guildId}: ${sanitizeFfmpegError(error)}`);
    } finally {
      clipPlayer.stop(true);
      subscription?.unsubscribe();
      if (resource && !resource.playStream.destroyed) {
        resource.playStream.destroy();
      }
    }
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
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }

  private stopAudioPlayer(force = false): void {
    if (!this.audioPlayer) {
      return;
    }

    this.programmaticallyStoppedAudioPlayers.add(this.audioPlayer);
    this.audioPlayer.stop(force);
  }

  private destroyStaleStream(stream: Readable): void {
    if (!stream.destroyed) {
      stream.destroy();
    }
  }
}
