import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const dependencies = vi.hoisted(() => ({
  autoStart: true,
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(),
  getGuildSettings: vi.fn(),
}));

vi.mock('@discordjs/voice', () => ({
  AudioPlayerStatus: {Idle: 'idle', Playing: 'playing', Buffering: 'buffering'},
  VoiceConnectionDisconnectReason: {WebSocketClose: 'websocket-close'},
  VoiceConnectionStatus: {Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed'},
  StreamType: {WebmOpus: 'webm-opus'},
  createAudioPlayer: dependencies.createAudioPlayer,
  createAudioResource: dependencies.createAudioResource,
  entersState: vi.fn().mockResolvedValue(undefined),
  joinVoiceChannel: vi.fn(),
}));
vi.mock('../src/services/file-cache.js', () => ({default: class {}}));
vi.mock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: dependencies.getGuildSettings}));
vi.mock('../src/utils/build-embed.js', () => ({buildPlayingMessageEmbed: vi.fn()}));

import Player, {MediaSource, type QueuedSong, STATUS} from '../src/services/player.js';
import ListeningSession, {type ListeningSessionRecord} from '../src/services/listening-session.js';
import {YtDlpMediaUnavailableError} from '../src/utils/yt-dlp.js';

const makeSong = (title: string): QueuedSong => ({
  title,
  artist: 'Artist',
  url: title.toLowerCase().replaceAll(' ', '-'),
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  addedInChannelId: 'text-channel',
  requestedBy: 'requester',
});

const makeConnection = () => ({
  state: {status: 'ready'},
  joinConfig: {channelId: 'voice-channel'},
  destroy: vi.fn(),
  subscribe: vi.fn(),
});

const makeHarness = (...songs: QueuedSong[]) => {
  const saved = new Map<string, ListeningSessionRecord>();
  const save = vi.fn(async (record: ListeningSessionRecord) => {
    saved.set(record.id, record);
  });
  const session = new ListeningSession('guild-id', {save});
  const player = new Player({} as never, 'guild-id', undefined, {playingMessageUpdateIntervalSeconds: 5, listeningSession: session});
  player.voiceConnection = makeConnection() as never;
  songs.forEach(song => player.add(song));
  const getStream = vi.fn().mockImplementation(async () => new Readable({read() {}}));
  Object.assign(player, {getStream});
  const finishTrack = () => (player as unknown as {
    onAudioPlayerIdle(previous: object, current: {status: string}): Promise<void>;
  }).onAudioPlayerIdle({}, {status: 'idle'});
  return {player, session, saved, save, getStream, finishTrack};
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  dependencies.autoStart = true;
  dependencies.createAudioPlayer.mockImplementation(() => {
    const audio = Object.assign(new EventEmitter(), {
      state: {status: 'idle', resource: undefined as unknown},
      play: vi.fn((resource: unknown) => {
        const previous = audio.state;
        audio.state = {status: dependencies.autoStart ? 'playing' : 'buffering', resource};
        audio.emit(audio.state.status, previous, audio.state);
      }),
      pause: vi.fn(() => { audio.state.status = 'paused'; }),
      unpause: vi.fn(() => {
        const previous = audio.state;
        audio.state = {...previous, status: 'playing'};
        audio.emit('playing', previous, audio.state);
      }),
      stop: vi.fn(() => { audio.state.status = 'idle'; }),
    });
    return audio;
  });
  dependencies.createAudioResource.mockImplementation((sourceStream: Readable) => ({
    sourceStream,
    volume: {setVolume: vi.fn()},
  }));
  dependencies.getGuildSettings.mockResolvedValue({
    autoAnnounceNextSong: false,
    secondsToWaitAfterQueueEmpties: 0,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('listening history through real Player transitions', () => {
  it('records only started songs and keeps the session open when the queue ends', async () => {
    const {player, session, saved, finishTrack} = makeHarness(makeSong('First'), makeSong('Second'), makeSong('Removed'));
    expect(session.snapshot()).toBeUndefined();
    await player.play();
    player.removeFromQueue(2);
    expect(session.snapshot()?.entries.map(entry => entry.title)).toEqual(['First']);

    await finishTrack();
    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['First', 'completed'], ['Second', 'playing'],
    ]);
    await finishTrack();
    await session.flush();

    expect(player.status).toBe(STATUS.IDLE);
    expect(player.voiceConnection).not.toBeNull();
    expect(session.snapshot()?.endedAt).toBeNull();
    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['First', 'completed'], ['Second', 'completed'],
    ]);
    expect(saved.get(session.snapshot()!.id)).toEqual(session.snapshot());
  });

  it('appends new requests to the same session after an idle gap', async () => {
    const {player, session, finishTrack} = makeHarness(makeSong('First'));
    await player.play();
    const id = session.snapshot()!.id;
    await session.setMessage('text-channel', 'shared-card');
    await finishTrack();
    player.add(makeSong('Later'));
    await player.play();

    expect(session.snapshot()).toMatchObject({id, messageId: 'shared-card', endedAt: null});
    expect(session.snapshot()?.entries.map(entry => entry.title)).toEqual(['First', 'Later']);
  });

  it('does not duplicate a play when pausing, resuming, or seeking', async () => {
    const {player, session} = makeHarness(makeSong('Track'));
    await player.play();
    player.pause();
    await player.play();
    await player.seek(40);
    player.pause();
    await player.seek(20, {preservePausedState: true});
    await player.play();

    expect(session.snapshot()?.entries).toHaveLength(1);
    expect(session.snapshot()?.entries[0].status).toBe('playing');
  });

  it('keeps repeat plays as separate entries, including loop-current playback', async () => {
    const repeated = makeSong('Repeated');
    const {player, session, finishTrack} = makeHarness(repeated, repeated);
    await player.play();
    await finishTrack();
    player.loopCurrentSong = true;
    await finishTrack();

    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['Repeated', 'completed'], ['Repeated', 'completed'], ['Repeated', 'playing'],
    ]);
    expect(new Set(session.snapshot()?.entries.map(entry => entry.id)).size).toBe(3);
  });

  it('marks manually skipped songs and omits passed-over songs that never played', async () => {
    const {player, session} = makeHarness(makeSong('Started'), makeSong('Passed over'), makeSong('Destination'));
    await player.play();
    await player.forward(2);

    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['Started', 'skipped'], ['Destination', 'playing'],
    ]);
  });

  it('records an explicit replay separately from ordinary seeking', async () => {
    const {player, session} = makeHarness(makeSong('Track'));
    await player.play();
    await player.replay();

    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['Track', 'skipped'], ['Track', 'playing'],
    ]);
  });

  it('does not list a paused skip destination until it starts playing', async () => {
    const {player, session} = makeHarness(makeSong('First'), makeSong('Next'));
    await player.play();
    player.pause();
    await player.forward(1);
    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['First', 'skipped'],
    ]);

    await player.play();

    expect(session.snapshot()?.entries.map(entry => [entry.title, entry.status])).toEqual([
      ['First', 'skipped'], ['Next', 'playing'],
    ]);
  });

  it.each(['stop', 'disconnect'] as const)('freezes a session on %s and starts a separate session on the next connection', async action => {
    const {player, session, saved} = makeHarness(makeSong('Original'));
    await player.play();
    const originalId = session.snapshot()!.id;
    player[action]();
    await session.flush();
    const finished = session.snapshot()!;
    expect(finished.endedAt).toBeInstanceOf(Date);
    expect(finished.endReason).toBe(action === 'stop' ? 'stopped' : 'disconnected');
    expect(finished.entries[0].status).toBe(finished.endReason);

    player.voiceConnection = makeConnection() as never;
    if (action === 'stop') {
      player.add(makeSong('New session'));
    }
    await player.play();
    await session.flush();

    expect(session.snapshot()!.id).not.toBe(originalId);
    expect(saved.get(originalId)).toEqual(finished);
    expect(saved.size).toBe(2);
  });

  it('keeps the shared card updater through queue completion and reuses it for later music', async () => {
    const {player, finishTrack} = makeHarness(makeSong('First'));
    await player.play();
    const update = vi.fn().mockResolvedValue(undefined);
    player.setPlayingMessageUpdater(update, 'shared-card', {keepAfterFinish: true});

    await finishTrack();
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith('finished'));
    expect(player.getPlayingMessageId()).toBe('shared-card');
    player.add(makeSong('Later'));
    await player.play();
    player.refreshPlayingMessage();

    await vi.waitFor(() => expect(update).toHaveBeenLastCalledWith(undefined));
    expect(player.getPlayingMessageId()).toBe('shared-card');
  });

  it('closes an idle session when the configured voice timeout expires', async () => {
    dependencies.getGuildSettings.mockResolvedValue({autoAnnounceNextSong: false, secondsToWaitAfterQueueEmpties: 60});
    const {player, session, finishTrack} = makeHarness(makeSong('First'));
    await player.play();
    await finishTrack();
    await vi.advanceTimersByTimeAsync(60_000);
    await session.flush();

    expect(player.voiceConnection).toBeNull();
    expect(session.snapshot()?.endReason).toBe('disconnected');
    expect(session.snapshot()?.entries[0].status).toBe('completed');
  });

  it('does not record startup failures that never yielded audio', async () => {
    const {player, session, getStream} = makeHarness(makeSong('Failed'));
    getStream.mockRejectedValueOnce(new Error('FFmpeg startup failed'));

    await expect(player.play()).rejects.toThrow('FFmpeg startup failed');

    expect(session.snapshot()).toBeUndefined();
  });

  it('does not record an unavailable track before the next playable song starts', async () => {
    const {player, session, getStream} = makeHarness(makeSong('Unavailable'), makeSong('Playable'));
    getStream.mockRejectedValueOnce(new YtDlpMediaUnavailableError('unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await player.play();

    expect(session.snapshot()?.entries.map(entry => entry.title)).toEqual(['Playable']);
  });

  it('does not record a stream that arrives after Stop cancels startup', async () => {
    const {player, session, getStream, save} = makeHarness(makeSong('Cancelled'));
    let resolveStream!: (stream: Readable) => void;
    const pendingStream = new Promise<Readable>(resolve => {
      resolveStream = resolve;
    });
    getStream.mockReturnValueOnce(pendingStream);
    const play = player.play();
    await vi.waitFor(() => expect(getStream).toHaveBeenCalledOnce());
    player.stop();
    const stream = new Readable({read() {}});
    resolveStream(stream);
    await play;
    await session.flush();

    expect(stream.destroyed).toBe(true);
    expect(session.snapshot()).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it('publishes a session while buffering but records a track only on Playing', async () => {
    dependencies.autoStart = false;
    const {player, session} = makeHarness(makeSong('Buffered'));
    await player.play();
    expect(session.snapshot()?.entries).toEqual([]);
    await session.setMessage('text-channel', 'shared-card');
    const id = session.snapshot()!.id;
    const audio = dependencies.createAudioPlayer.mock.results.at(-1)!.value;
    audio.emit('playing', audio.state, {...audio.state, status: 'playing'});
    expect(session.snapshot()).toMatchObject({id, messageId: 'shared-card'});
    expect(session.snapshot()?.entries.map(entry => entry.title)).toEqual(['Buffered']);
  });

  it.each(['stop', 'disconnect'] as const)('omits audio that is %s while buffering and ignores its late Playing event', async action => {
    dependencies.autoStart = false;
    const {player, session} = makeHarness(makeSong('Never played'));
    await player.play();
    const audio = dependencies.createAudioPlayer.mock.results.at(-1)!.value;
    const buffered = {...audio.state};
    player[action]();
    audio.emit('playing', buffered, {...buffered, status: 'playing'});
    await session.flush();
    expect(session.snapshot()?.entries).toEqual([]);
    expect(session.snapshot()?.endedAt).toBeInstanceOf(Date);
  });

  it('omits audio that closes during buffering and records the next track when it plays', async () => {
    dependencies.autoStart = false;
    const {player, session, finishTrack} = makeHarness(makeSong('Decode failure'), makeSong('Playable'));
    await player.play();
    const oldAudio = dependencies.createAudioPlayer.mock.results.at(-1)!.value;
    const buffered = {...oldAudio.state};
    dependencies.autoStart = true;
    await finishTrack();
    oldAudio.emit('playing', buffered, {...buffered, status: 'playing'});
    expect(session.snapshot()?.entries.map(entry => entry.title)).toEqual(['Playable']);
  });

});

describe('public session message retries', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('recovers a transient live publication failure and keeps later track history and queue completion updating', async () => {
    const {player, session, finishTrack} = makeHarness(makeSong('First'), makeSong('Second'));
    await player.play();
    const renders: Array<{terminal: unknown; entries: Array<[string, string]>}> = [];
    const update = vi.fn(async (terminal: unknown) => {
      renders.push({terminal, entries: session.snapshot()!.entries.map(entry => [entry.title, entry.status])});
    }).mockRejectedValueOnce(new Error('Discord temporarily unavailable'));
    player.setPlayingMessageUpdater(update, 'session-card', {keepAfterFinish: true, retryOnError: true});
    player.refreshPlayingMessage();
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledOnce();
    expect(player.getPlayingMessageId()).toBe('session-card');

    await vi.advanceTimersByTimeAsync(2999);
    expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(renders.at(-1)).toEqual({terminal: undefined, entries: [['First', 'playing']]});

    await finishTrack();
    await vi.advanceTimersByTimeAsync(0);
    expect(renders.at(-1)).toEqual({terminal: undefined, entries: [['First', 'completed'], ['Second', 'playing']]});
    await finishTrack();
    await vi.advanceTimersByTimeAsync(0);
    expect(renders.at(-1)).toEqual({terminal: 'finished', entries: [['First', 'completed'], ['Second', 'completed']]});
    expect(player.getPlayingMessageId()).toBe('session-card');
  });

  it.each(['stop', 'disconnect'] as const)('retries a failed final %s recap after three seconds without an audio clock', async action => {
    const {player, session} = makeHarness(makeSong('Track'));
    await player.play();
    player.pause();
    const update = vi.fn().mockRejectedValueOnce(new Error('Discord temporarily unavailable')).mockResolvedValue(undefined);
    player.setPlayingMessageUpdater(update, 'session-card', {keepAfterFinish: true, retryOnError: true});
    player[action]();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.voiceConnection).toBeNull();
    expect(update).toHaveBeenCalledOnce();
    expect(player.getPlayingMessageId()).toBe('session-card');

    await vi.advanceTimersByTimeAsync(2999);
    expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    const terminal = action === 'stop' ? 'stopped' : 'disconnected';
    expect(update.mock.calls).toEqual([[terminal], [terminal]]);
    expect(session.snapshot()?.endReason).toBe(terminal);
    expect(player.getPlayingMessageId()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds automatic retries, avoids an immediate failure loop, and permits later controls to recover', async () => {
    const {player} = makeHarness(makeSong('Paused track'));
    await player.play();
    player.pause();
    const update = vi.fn().mockRejectedValue(new Error('Discord unavailable'));
    player.setPlayingMessageUpdater(update, 'session-card', {keepAfterFinish: true, retryOnError: true});
    player.refreshPlayingMessage();
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2999);
    expect(update).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(update).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(update).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(player.getPlayingMessageId()).toBe('session-card');

    update.mockResolvedValue(undefined);
    player.setVolume(45);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(5);
    expect(player.getPlayingMessageId()).toBe('session-card');

    update.mockRejectedValueOnce(new Error('Another transient outage'));
    player.setVolume(50);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(3000);
    expect(update).toHaveBeenCalledTimes(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds retries of a disconnected final recap after the audio clock has stopped', async () => {
    const {player} = makeHarness(makeSong('Track'));
    await player.play();
    player.pause();
    const update = vi.fn().mockRejectedValue(new Error('Discord unavailable'));
    player.setPlayingMessageUpdater(update, 'session-card', {keepAfterFinish: true, retryOnError: true});
    player.disconnect();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(update.mock.calls).toEqual(Array.from({length: 4}, () => ['disconnected']));
    expect(vi.getTimerCount()).toBe(0);
    expect(player.voiceConnection).toBeNull();
  });

  it('lets an older terminal retry finish without retiring or rendering progress into a new session card', async () => {
    const {player, session} = makeHarness(makeSong('Original'));
    await player.play();
    player.pause();
    const originalId = session.snapshot()!.id;
    let rejectOld!: (error: Error) => void;
    const oldUpdate = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; })).mockResolvedValue(undefined);
    player.setPlayingMessageUpdater(oldUpdate, 'old-card', {keepAfterFinish: true, retryOnError: true});
    player.disconnect();

    const newUpdate = vi.fn().mockResolvedValue(undefined);
    player.setPlayingMessageUpdater(newUpdate, 'new-card', {keepAfterFinish: true, retryOnError: true});
    player.voiceConnection = makeConnection() as never;
    await player.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot()!.id).not.toBe(originalId);
    const newCalls = newUpdate.mock.calls.length;
    rejectOld(new Error('Old recap temporarily unavailable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getPlayingMessageId()).toBe('new-card');
    await vi.advanceTimersByTimeAsync(3000);

    expect(oldUpdate.mock.calls).toEqual([['disconnected'], ['disconnected']]);
    expect(newUpdate).toHaveBeenCalledTimes(newCalls);
    expect(player.getPlayingMessageId()).toBe('new-card');
    expect(player.isPlayingMessage('new-card')).toBe(true);
    player.setVolume(35);
    await vi.advanceTimersByTimeAsync(0);
    expect(newUpdate).toHaveBeenCalledTimes(newCalls + 1);
  });

  it('preserves immediate retirement for updaters that did not opt into retry', async () => {
    const {player} = makeHarness(makeSong('Track'));
    await player.play();
    player.pause();
    const update = vi.fn().mockRejectedValue(new Error('Legacy response gone'));
    player.setPlayingMessageUpdater(update, 'legacy-card', {keepAfterFinish: true});
    player.refreshPlayingMessage();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(update).toHaveBeenCalledOnce();
    expect(player.getPlayingMessageId()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
