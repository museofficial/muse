import {Readable} from 'node:stream';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(),
  entersState: vi.fn(),
  getGuildSettings: vi.fn(),
  joinVoiceChannel: vi.fn(),
}));

vi.mock('@discordjs/voice', () => ({
  AudioPlayerStatus: {Idle: 'idle'},
  VoiceConnectionDisconnectReason: {WebSocketClose: 'websocket-close'},
  VoiceConnectionStatus: {
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Ready: 'ready',
    Signalling: 'signalling',
  },
  StreamType: {WebmOpus: 'webm-opus'},
  createAudioPlayer: dependencyMocks.createAudioPlayer,
  createAudioResource: dependencyMocks.createAudioResource,
  entersState: dependencyMocks.entersState,
  joinVoiceChannel: dependencyMocks.joinVoiceChannel,
}));

vi.mock('../src/services/file-cache.js', () => ({
  default: class {},
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: dependencyMocks.getGuildSettings,
}));

vi.mock('../src/utils/build-embed.js', () => ({
  buildPlayingMessageEmbed: vi.fn(() => ({title: 'playing'})),
}));

import Player, {MediaSource, QueuedSong, SongMetadata, STATUS} from '../src/services/player.js';
import getProgressBar from '../src/utils/get-progress-bar.js';
import {YtDlpMediaUnavailableError} from '../src/utils/yt-dlp.js';

const GUILD_ID = 'guild-id';

const makeDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {promise, reject, resolve};
};

const makeTrackedStream = () => {
  const stream = new Readable({read() {}});
  const destroy = vi.spyOn(stream, 'destroy');

  return {destroy, stream};
};

const makeSong = (title: string, overrides: Partial<QueuedSong> = {}): QueuedSong => ({
  title,
  artist: 'Artist',
  url: title.toLowerCase().replaceAll(' ', '-'),
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
  ...overrides,
});

const makeAudioPlayer = () => ({
  listeners: vi.fn(() => []),
  on: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  unpause: vi.fn(),
});

const makeVoiceConnection = () => ({
  destroy: vi.fn(),
  on: vi.fn(),
  receiver: {speaking: {on: vi.fn()}},
  rejoin: vi.fn(),
  rejoinAttempts: 0,
  state: {status: 'ready'},
  subscribe: vi.fn(),
});

const makeReadyPlayer = (ageRestrictedFallbackResolver?: (song: QueuedSong) => Promise<SongMetadata | null>) => {
  const player = new Player({} as never, GUILD_ID, ageRestrictedFallbackResolver);
  const voiceConnection = makeVoiceConnection();
  const getStream = vi.fn().mockResolvedValue(Readable.from([]));

  player.voiceConnection = voiceConnection as never;
  Object.assign(player, {getStream});

  return {getStream, player, voiceConnection};
};

const getPrivateState = (player: Player) => player as unknown as {
  audioPlayer: ReturnType<typeof makeAudioPlayer> | null;
  audioResource: {sourceStream?: Readable; volume: {setVolume: ReturnType<typeof vi.fn>}} | null;
  channelToSpeakingUsers: Map<string, Set<string>>;
  currentChannel: object | undefined;
  currentQueueEntryVersion: number;
  finishQueue(): Promise<void>;
  nowPlaying: QueuedSong | null;
  nowPlayingQueueEntryVersion: number | null;
  playAudioPlayerResource(resource: object): void;
};

const installVoiceActivityFakes = (player: Player) => {
  const handlers = new Map<string, (userId: string) => void>();
  const voiceConnection = makeVoiceConnection();
  voiceConnection.receiver.speaking.on.mockImplementation((event: string, handler: (userId: string) => void) => {
    handlers.set(event, handler);
  });
  const setAudioVolume = vi.fn();
  const members = new Map([
    ['speaker-one', {id: 'speaker-one'}],
    ['speaker-two', {id: 'speaker-two'}],
  ]);

  player.voiceConnection = voiceConnection as never;
  Object.assign(player, {
    audioPlayer: makeAudioPlayer(),
    audioResource: {volume: {setVolume: setAudioVolume}},
    currentChannel: {id: 'voice-channel-id', members},
  });
  player.registerVoiceActivityListener({
    turnDownVolumeWhenPeopleSpeak: true,
    turnDownVolumeWhenPeopleSpeakTarget: 20,
  } as never);

  return {handlers, members, setAudioVolume, voiceConnection};
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  dependencyMocks.createAudioPlayer.mockImplementation(makeAudioPlayer);
  dependencyMocks.createAudioResource.mockImplementation((sourceStream: Readable) => ({
    sourceStream,
    volume: {setVolume: vi.fn()},
  }));
  dependencyMocks.entersState.mockResolvedValue(undefined);
  dependencyMocks.getGuildSettings.mockResolvedValue({
    autoAnnounceNextSong: false,
    secondsToWaitAfterQueueEmpties: 0,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Player forward state transitions', () => {
  it('restores the exact original queue position when a multi-skip destination fails to play', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.add(makeSong('Original'));
    player.add(makeSong('Skipped'));
    player.add(makeSong('Failed destination'));
    player.status = STATUS.PLAYING;
    vi.spyOn(player, 'play').mockRejectedValue(new Error('playback failed'));

    await expect(player.forward(2)).rejects.toThrow('playback failed');

    expect(player.getCurrent()?.title).toBe('Original');
    expect(player.getQueue().map(song => song.title)).toEqual(['Skipped', 'Failed destination']);
  });

  it('moves a paused non-empty queue forward while remaining paused and never schedules idle disconnect', async () => {
    const player = new Player({} as never, GUILD_ID);
    const voiceConnection = makeVoiceConnection();
    player.voiceConnection = voiceConnection as never;
    player.add(makeSong('First'));
    player.add(makeSong('Second'));
    player.status = STATUS.PAUSED;
    dependencyMocks.getGuildSettings.mockResolvedValue({secondsToWaitAfterQueueEmpties: 5});

    await player.forward(1);

    expect(player.getCurrent()?.title).toBe('Second');
    expect(player.status).toBe(STATUS.PAUSED);
    expect(dependencyMocks.getGuildSettings).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(voiceConnection.destroy).not.toHaveBeenCalled();
  });

  it('finishes a paused queue only when forwarding reaches no current entry', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.add(makeSong('Only entry'));
    player.status = STATUS.PAUSED;

    await player.forward(1);

    expect(player.getCurrent()).toBeNull();
    expect(player.status).toBe(STATUS.IDLE);
    expect(dependencyMocks.getGuildSettings).toHaveBeenCalledOnce();
  });

  it('keeps a newer C transition when an older B stream resolves afterward', async () => {
    const {getStream, player} = makeReadyPlayer();
    const first = makeSong('A');
    const slowDestination = makeSong('B');
    const newerDestination = makeSong('C');
    player.add(first);
    player.add(slowDestination);
    player.add(newerDestination);
    await player.play();

    const slowStream = makeTrackedStream();
    const newerStream = makeTrackedStream();
    const slowStreamStarted = makeDeferred<void>();
    const slowStreamResult = makeDeferred<Readable>();
    getStream.mockReset();
    getStream.mockImplementation((song: QueuedSong) => {
      if (song === slowDestination) {
        slowStreamStarted.resolve(undefined);
        return slowStreamResult.promise;
      }

      if (song === newerDestination) {
        return Promise.resolve(newerStream.stream);
      }

      throw new Error(`Unexpected stream request for ${song.title}`);
    });

    const olderForward = player.forward(1);
    await slowStreamStarted.promise;
    await player.forward(1);
    const newerAudioPlayer = getPrivateState(player).audioPlayer;
    const newerEntryId = player.getCurrentQueueEntryId();

    slowStreamResult.resolve(slowStream.stream);
    await olderForward;

    const state = getPrivateState(player);
    expect(player.getCurrent()).toBe(newerDestination);
    expect(player.getCurrentQueueEntryId()).toBe(newerEntryId);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(state.nowPlaying).toBe(newerDestination);
    expect(state.nowPlayingQueueEntryVersion).toBe(newerEntryId);
    expect(state.audioPlayer).toBe(newerAudioPlayer);
    expect(state.audioResource?.sourceStream).toBe(newerStream.stream);
    expect(slowStream.destroy).toHaveBeenCalledOnce();
  });

  it('does not roll back a newer C transition when an older B stream rejects', async () => {
    const {getStream, player} = makeReadyPlayer();
    const first = makeSong('A');
    const slowDestination = makeSong('B');
    const newerDestination = makeSong('C');
    player.add(first);
    player.add(slowDestination);
    player.add(newerDestination);
    await player.play();

    const slowStreamStarted = makeDeferred<void>();
    const slowStreamResult = makeDeferred<Readable>();
    const newerStream = makeTrackedStream();
    getStream.mockReset();
    getStream.mockImplementation((song: QueuedSong) => {
      if (song === slowDestination) {
        slowStreamStarted.resolve(undefined);
        return slowStreamResult.promise;
      }

      return Promise.resolve(newerStream.stream);
    });

    const olderForward = player.forward(1);
    await slowStreamStarted.promise;
    await player.forward(1);
    const newerEntryId = player.getCurrentQueueEntryId();
    const newerAudioPlayer = getPrivateState(player).audioPlayer;

    slowStreamResult.reject(new Error('stale B extraction failed'));
    await expect(olderForward).rejects.toThrow('stale B extraction failed');

    const state = getPrivateState(player);
    expect(player.getCurrent()).toBe(newerDestination);
    expect(player.getCurrentQueueEntryId()).toBe(newerEntryId);
    expect(state.currentQueueEntryVersion).toBe(newerEntryId);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(state.nowPlaying).toBe(newerDestination);
    expect(state.nowPlayingQueueEntryVersion).toBe(newerEntryId);
    expect(state.audioPlayer).toBe(newerAudioPlayer);
  });

  it('does not run unavailable fallback or advance when an older B extraction fails after C succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resolver = vi.fn().mockResolvedValue(null);
    const {getStream, player} = makeReadyPlayer(resolver);
    const first = makeSong('A');
    const slowDestination = makeSong('B');
    const newerDestination = makeSong('C');
    player.add(first);
    player.add(slowDestination);
    player.add(newerDestination);
    await player.play();

    const slowStreamStarted = makeDeferred<void>();
    const slowStreamResult = makeDeferred<Readable>();
    const newerStream = makeTrackedStream();
    getStream.mockReset();
    getStream.mockImplementation((song: QueuedSong) => {
      if (song === slowDestination) {
        slowStreamStarted.resolve(undefined);
        return slowStreamResult.promise;
      }

      return Promise.resolve(newerStream.stream);
    });

    const olderForward = player.forward(1);
    await slowStreamStarted.promise;
    await player.forward(1);
    const newerEntryId = player.getCurrentQueueEntryId();

    slowStreamResult.reject(new YtDlpMediaUnavailableError('sign in to confirm your age', 'age-restricted'));
    await expect(olderForward).rejects.toBeInstanceOf(YtDlpMediaUnavailableError);

    const state = getPrivateState(player);
    expect(player.getCurrent()).toBe(newerDestination);
    expect(player.getCurrentQueueEntryId()).toBe(newerEntryId);
    expect(state.currentQueueEntryVersion).toBe(newerEntryId);
    expect(player.status).toBe(STATUS.PLAYING);
    expect(state.nowPlaying).toBe(newerDestination);
    expect(state.nowPlayingQueueEntryVersion).toBe(newerEntryId);
    expect(resolver).not.toHaveBeenCalled();
    expect(getStream).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('Player playback attempt ownership', () => {
  it('keeps the newest play attempt for the same queue entry', async () => {
    const {getStream, player} = makeReadyPlayer();
    const song = makeSong('Same entry');
    const olderStream = makeTrackedStream();
    const newerStream = makeTrackedStream();
    const olderStreamStarted = makeDeferred<void>();
    const olderStreamResult = makeDeferred<Readable>();
    player.add(song);
    getStream
      .mockImplementationOnce(() => {
        olderStreamStarted.resolve(undefined);
        return olderStreamResult.promise;
      })
      .mockResolvedValueOnce(newerStream.stream);

    const olderPlay = player.play();
    await olderStreamStarted.promise;
    await player.play();
    const newerAudioPlayer = getPrivateState(player).audioPlayer;

    olderStreamResult.resolve(olderStream.stream);
    await olderPlay;

    const state = getPrivateState(player);
    expect(player.getCurrent()).toBe(song);
    expect(state.nowPlaying).toBe(song);
    expect(state.nowPlayingQueueEntryVersion).toBe(player.getCurrentQueueEntryId());
    expect(state.audioPlayer).toBe(newerAudioPlayer);
    expect(state.audioResource?.sourceStream).toBe(newerStream.stream);
    expect(olderStream.destroy).toHaveBeenCalledOnce();
  });
});

describe('Player same-URL entry identity', () => {
  it('exposes a distinct identity when a loop reuses the same song object as a new queue entry', () => {
    const player = new Player({} as never, GUILD_ID);
    const repeatedSong = makeSong('Looped entry');
    player.add(repeatedSong);
    const originalEntryIdentity = player.getCurrentQueueEntryId();

    player.add(repeatedSong);
    player.manualForward(1);

    expect(player.getCurrent()).toBe(repeatedSong);
    expect(originalEntryIdentity).not.toBeNull();
    expect(typeof originalEntryIdentity).toBe('number');
    expect(player.getCurrentQueueEntryId()).not.toBe(originalEntryIdentity);
  });

  it.each([
    ['duplicate', makeSong('Duplicate', {url: 'shared-video'})],
    ['split chapter', makeSong('Chapter two', {url: 'shared-video', offset: 30, length: 40})],
  ])('starts a different %s entry from zero instead of resuming the old audio resource', async (_name, nextSong) => {
    const {getStream, player} = makeReadyPlayer();
    const firstSong = makeSong('First entry', {url: 'shared-video', length: 30});
    player.add(firstSong);
    player.add(nextSong);

    await player.play();
    await vi.advanceTimersByTimeAsync(4_000);
    player.pause();
    const firstAudioPlayer = dependencyMocks.createAudioPlayer.mock.results[0].value as ReturnType<typeof makeAudioPlayer>;

    player.manualForward(1);
    await player.play();

    expect(player.getCurrent()).toBe(nextSong);
    expect(player.getPosition()).toBe(0);
    expect(firstAudioPlayer.unpause).not.toHaveBeenCalled();
    expect(dependencyMocks.createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(getStream).toHaveBeenLastCalledWith(nextSong, {
      seek: nextSong.offset,
      to: nextSong.offset + nextSong.length,
    });
  });

  it('recreates a disconnected same-entry stream at its retained position', async () => {
    const {getStream, player} = makeReadyPlayer();
    const song = makeSong('Resume me', {url: 'same-entry'});
    player.add(song);

    await player.play();
    await vi.advanceTimersByTimeAsync(7_000);
    player.disconnect();
    player.voiceConnection = makeVoiceConnection() as never;

    await player.play();

    expect(player.getCurrent()).toBe(song);
    expect(player.getPosition()).toBe(7);
    expect(getStream).toHaveBeenLastCalledWith(song, {seek: 7, to: 100});
  });

  it('treats the same song object queued twice as two different entries', async () => {
    const {getStream, player} = makeReadyPlayer();
    const repeatedSong = makeSong('Looped entry', {url: 'shared-object-video'});
    player.add(repeatedSong);
    player.add(repeatedSong);

    await player.play();
    await vi.advanceTimersByTimeAsync(4_000);
    player.pause();
    const firstAudioPlayer = dependencyMocks.createAudioPlayer.mock.results[0].value as ReturnType<typeof makeAudioPlayer>;

    player.manualForward(1);
    await player.play();

    expect(player.getPosition()).toBe(0);
    expect(firstAudioPlayer.unpause).not.toHaveBeenCalled();
    expect(dependencyMocks.createAudioPlayer).toHaveBeenCalledTimes(2);
    expect(getStream).toHaveBeenCalledTimes(2);
  });
});

describe('Player queue-finish timer state', () => {
  it('stops the position interval before becoming idle', async () => {
    const {player} = makeReadyPlayer();
    player.add(makeSong('Last song'));
    await player.play();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(player.getPosition()).toBe(3);

    await getPrivateState(player).finishQueue();

    expect(player.status).toBe(STATUS.IDLE);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(player.getPosition()).toBe(3);
  });
});

describe('Player voice ducking', () => {
  it('stores a manual session volume once across overlapping speakers and restores it after the last speaker', () => {
    const player = new Player({} as never, GUILD_ID);
    const {handlers, setAudioVolume} = installVoiceActivityFakes(player);
    player.setVolume(35);

    handlers.get('start')!('speaker-one');
    handlers.get('start')!('speaker-two');
    handlers.get('end')!('speaker-one');
    handlers.get('end')!('speaker-two');

    expect(setAudioVolume.mock.calls.map(([level]) => level)).toEqual([
      0.35,
      0.2,
      0.2,
      0.2,
      0.35,
    ]);
    expect(player.getVolume()).toBe(35);
  });

  it('applies the ducking target to a new audio resource while a speaker remains active', () => {
    const player = new Player({} as never, GUILD_ID);
    const {handlers} = installVoiceActivityFakes(player);
    player.setVolume(35);
    handlers.get('start')!('speaker-one');
    const nextResourceVolume = vi.fn();

    getPrivateState(player).playAudioPlayerResource({
      volume: {setVolume: nextResourceVolume},
    });

    expect(nextResourceVolume).toHaveBeenLastCalledWith(0.2);
  });

  it('clears ducking state on disconnect so the next session can establish and restore its own volume', () => {
    const player = new Player({} as never, GUILD_ID);
    const firstSession = installVoiceActivityFakes(player);
    player.setVolume(35);
    firstSession.handlers.get('start')!('speaker-one');

    player.disconnect();

    expect(player.getVolume()).toBe(35);
    const secondSession = installVoiceActivityFakes(player);
    player.setVolume(70);
    expect(secondSession.setAudioVolume).toHaveBeenLastCalledWith(0.7);
    secondSession.handlers.get('start')!('speaker-one');
    secondSession.handlers.get('end')!('speaker-one');
    expect(secondSession.setAudioVolume).toHaveBeenLastCalledWith(0.7);
    expect(player.getVolume()).toBe(70);
  });

  it('ignores a late end callback from a disconnected session while the new session remains ducked', () => {
    const player = new Player({} as never, GUILD_ID);
    const firstSession = installVoiceActivityFakes(player);
    player.setVolume(35);
    firstSession.handlers.get('start')!('speaker-one');
    player.disconnect();

    const secondSession = installVoiceActivityFakes(player);
    player.setVolume(70);
    secondSession.handlers.get('start')!('speaker-one');
    const secondSessionCallCount = secondSession.setAudioVolume.mock.calls.length;

    firstSession.handlers.get('end')!('speaker-one');

    expect(player.getVolume()).toBe(20);
    expect(secondSession.setAudioVolume).toHaveBeenCalledTimes(secondSessionCallCount);
  });

  it('ignores a late start callback from a disconnected session after the new session becomes quiet', () => {
    const player = new Player({} as never, GUILD_ID);
    const firstSession = installVoiceActivityFakes(player);
    player.setVolume(35);
    firstSession.handlers.get('start')!('speaker-one');
    player.disconnect();

    const secondSession = installVoiceActivityFakes(player);
    player.setVolume(70);
    const secondSessionCallCount = secondSession.setAudioVolume.mock.calls.length;

    firstSession.handlers.get('start')!('speaker-one');

    expect(player.getVolume()).toBe(70);
    expect(secondSession.setAudioVolume).toHaveBeenCalledTimes(secondSessionCallCount);
  });

  it('restores volume when a recorded speaker leaves before their end event', () => {
    const player = new Player({} as never, GUILD_ID);
    const {handlers, members, setAudioVolume} = installVoiceActivityFakes(player);
    player.setVolume(35);
    handlers.get('start')!('speaker-one');
    members.delete('speaker-one');

    handlers.get('end')!('speaker-one');

    expect(setAudioVolume).toHaveBeenLastCalledWith(0.35);
    expect(player.getVolume()).toBe(35);
  });
});

describe('Player age-restricted fallback preservation', () => {
  it('still replaces an age-restricted entry with its audio fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fallback = makeSong('Fallback audio', {url: 'fallback-id'});
    const resolver = vi.fn().mockResolvedValue(fallback);
    const {getStream, player} = makeReadyPlayer(resolver);
    const original = makeSong('Age restricted', {
      url: 'restricted-id',
      playlist: {title: 'Requested playlist', source: 'playlist-id'},
    });
    player.add(original);
    getStream
      .mockRejectedValueOnce(new YtDlpMediaUnavailableError('sign in to confirm your age', 'age-restricted'))
      .mockResolvedValueOnce(Readable.from([]));

    await player.play();

    expect(resolver).toHaveBeenCalledWith(original);
    expect(player.getCurrent()).toMatchObject({
      url: 'fallback-id',
      playlist: original.playlist,
      addedInChannelId: original.addedInChannelId,
      requestedBy: original.requestedBy,
    });
    expect(player.status).toBe(STATUS.PLAYING);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Trying audio fallback'));
  });

  it('does not apply a slow fallback to a later loop entry that reuses the same song object', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fallback = makeSong('Fallback audio', {url: 'fallback-id'});
    const fallbackStarted = makeDeferred<void>();
    const fallbackResult = makeDeferred<SongMetadata | null>();
    const resolver = vi.fn().mockImplementation(() => {
      fallbackStarted.resolve(undefined);
      return fallbackResult.promise;
    });
    const {getStream, player} = makeReadyPlayer(resolver);
    const loopedSong = makeSong('Age restricted', {url: 'restricted-id'});
    player.add(loopedSong);
    player.add(loopedSong);
    const firstEntryId = player.getCurrentQueueEntryId();
    getStream
      .mockRejectedValueOnce(new YtDlpMediaUnavailableError('sign in to confirm your age', 'age-restricted'))
      .mockResolvedValueOnce(Readable.from([]));

    const firstEntryPlay = player.play();
    await fallbackStarted.promise;
    player.manualForward(1);
    const loopedEntryId = player.getCurrentQueueEntryId();
    expect(loopedEntryId).not.toBe(firstEntryId);

    fallbackResult.resolve(fallback);
    await firstEntryPlay;

    const state = getPrivateState(player);
    expect(player.getCurrent()).toBe(loopedSong);
    expect(player.getCurrentQueueEntryId()).toBe(loopedEntryId);
    expect(state.currentQueueEntryVersion).toBe(loopedEntryId);
    expect(player.status).toBe(STATUS.PAUSED);
    expect(state.nowPlaying).toBeNull();
    expect(state.nowPlayingQueueEntryVersion).toBeNull();
    expect(state.audioPlayer).toBeNull();
    expect(getStream).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rechecks ownership after an unusable fallback resolves before advancing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let newerForward: Promise<void> | undefined;
    let player: Player;
    const unusableFallback = makeSong('Unusable fallback');
    Object.defineProperty(unusableFallback, 'source', {
      get: () => {
        queueMicrotask(() => {
          newerForward = player.forward(1);
        });

        return MediaSource.HLS;
      },
    });
    const resolver = vi.fn().mockResolvedValue(unusableFallback);
    const readyPlayer = makeReadyPlayer(resolver);
    player = readyPlayer.player;
    const restricted = makeSong('Age restricted', {url: 'restricted-id'});
    const newerEntry = makeSong('Newer entry');
    player.add(restricted);
    player.add(newerEntry);
    readyPlayer.getStream.mockRejectedValueOnce(
      new YtDlpMediaUnavailableError('sign in to confirm your age', 'age-restricted'),
    );

    await expect(player.play()).rejects.toBeInstanceOf(YtDlpMediaUnavailableError);
    await newerForward;

    expect(player.getCurrent()).toBe(newerEntry);
    expect(player.status).toBe(STATUS.PAUSED);
    expect(player.getQueue()).toEqual([]);
    expect(readyPlayer.getStream).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('progress marker bounds', () => {
  it.each([
    [0, true, false],
    [1, false, true],
  ])('shows exactly one visible marker at progress %s', (progress, startsWithMarker, endsWithMarker) => {
    const progressBar = getProgressBar(10, progress);
    const characters = [...progressBar];

    expect(characters).toHaveLength(10);
    expect(characters.filter(character => character === '🔘')).toHaveLength(1);
    expect(progressBar.startsWith('🔘')).toBe(startsWithMarker);
    expect(progressBar.endsWith('🔘')).toBe(endsWithMarker);
  });
});
