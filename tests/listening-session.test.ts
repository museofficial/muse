import {afterEach, describe, expect, it, vi} from 'vitest';
import ListeningSession from '../src/services/listening-session.js';
import {MediaSource} from '../src/services/player-types.js';

const song = {
  title: 'Original song',
  artist: 'Artist',
  url: 'original-video',
  source: MediaSource.Youtube,
  length: 195,
  offset: 2.5,
  requestedBy: 'listener',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('listening sessions', () => {
  it('starts only when audio plays, records original metadata, and exposes isolated snapshots', async () => {
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    expect(session.snapshot()).toBeUndefined();
    session.endTrack('completed');
    session.finish('disconnected');
    await session.setMessage('channel', 'message');
    expect(store.save).not.toHaveBeenCalled();

    session.startTrack(song, 'voice', 1);
    const snapshot = session.snapshot()!;
    expect(snapshot).toMatchObject({guildId: 'guild', voiceChannelId: 'voice', endedAt: null});
    expect(snapshot.entries).toEqual([expect.objectContaining({...song, source: 'Youtube', status: 'playing'})]);
    snapshot.startedAt.setTime(0);
    snapshot.entries[0].startedAt.setTime(0);
    snapshot.entries[0].title = 'Changed externally';
    snapshot.entries.length = 0;
    expect(session.snapshot()!.entries[0].title).toBe('Original song');
    expect(session.snapshot()!.startedAt.getTime()).not.toBe(0);
    expect(session.snapshot()!.entries[0].startedAt.getTime()).not.toBe(0);
    await session.flush();
  });

  it('does not duplicate seek/resume events, but records replays and distinct queue entries', async () => {
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    session.startTrack({...song, offset: 45}, 'voice', 1);
    session.startTrack(song, 'voice', 1);
    await session.flush();
    expect(session.snapshot()!.entries).toHaveLength(1);
    expect(store.save).toHaveBeenCalledOnce();

    session.endTrack('completed');
    session.startTrack(song, 'voice', 1);
    session.endTrack('skipped');
    session.startTrack(song, 'voice', 2);
    await session.flush();
    expect(session.snapshot()!.entries.map(entry => entry.status)).toEqual(['completed', 'skipped', 'playing']);
    expect(new Set(session.snapshot()!.entries.map(entry => entry.id)).size).toBe(3);
  });

  it('retains the original private channel after failed first writes and a later request', async () => {
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockRejectedValue(error)};
    const session = new ListeningSession('guild', store);
    session.prepare('voice', 'private-channel');
    const id = session.snapshot()!.id;
    expect(session.snapshot()).toMatchObject({channelId: 'private-channel', messageId: null, entries: []});
    await expect(session.flush()).rejects.toBe(error);

    session.prepare('voice', 'public-channel');
    session.setChannel('public-channel');
    session.startTrack(song, 'voice', 1);
    store.save.mockResolvedValue(undefined);
    await session.flush();
    expect(session.snapshot()).toMatchObject({id, channelId: 'private-channel', messageId: null});
    expect(store.save.mock.calls.every(([record]) => record.channelId === 'private-channel')).toBe(true);
    await expect(session.setMessage('public-channel', 'wrong-card')).rejects.toThrow('cannot move');
    await session.setMessage('private-channel', 'correct-card');
    expect(session.snapshot()).toMatchObject({channelId: 'private-channel', messageId: 'correct-card'});
  });

  it('binds an unbound session once and allows a new session to use another origin', async () => {
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.setChannel('before-session');
    expect(session.snapshot()).toBeUndefined();
    session.prepare('voice');
    session.setChannel('original-channel');
    session.setChannel('other-channel');
    session.prepare('voice', 'other-channel');
    await session.flush();
    expect(session.snapshot()!.channelId).toBe('original-channel');
    expect(store.save).toHaveBeenCalledTimes(2);

    session.finish('stopped');
    session.prepare('voice', 'new-session-channel');
    expect(session.snapshot()!.channelId).toBe('new-session-channel');
    await session.flush();
  });

  it.each([null, 'previous-card'])('restores the previous %s binding after a sustained save failure', async previousId => {
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.prepare('voice', 'channel');
    await session.setMessage('channel', previousId);
    store.save.mockRejectedValue(error);
    await expect(session.setMessage('channel', 'new-card')).rejects.toBe(error);
    expect(session.snapshot()!.messageId).toBe(previousId);

    session.endTrack('completed');
    store.save.mockResolvedValue(undefined);
    await session.flush();
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({messageId: previousId}));
  });

  it('retains playback changes while restoring a failed card binding', async () => {
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    await session.setMessage('channel', 'previous-card');
    store.save.mockImplementation(async () => {
      session.endTrack('completed');
      throw error;
    });
    await expect(session.setMessage('channel', 'new-card')).rejects.toBe(error);
    expect(session.snapshot()).toMatchObject({messageId: 'previous-card', entries: [expect.objectContaining({status: 'completed'})]});
    store.save.mockResolvedValue(undefined);
    await session.flush();
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({messageId: 'previous-card', entries: [expect.objectContaining({status: 'completed'})]}));
  });

  it('does not roll a failed old binding back over a newer session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.prepare('voice', 'channel');
    await session.setMessage('channel', 'previous-card');
    const oldId = session.snapshot()!.id;
    let changed = false;
    store.save.mockImplementation(async saved => {
      if (saved.id === oldId) {
        if (!changed) {
          changed = true;
          session.finish('stopped');
          session.prepare('voice', 'new-channel');
        }
        throw error;
      }
    });
    await expect(session.setMessage('channel', 'new-card')).rejects.toBe(error);
    expect(session.snapshot()).toMatchObject({channelId: 'new-channel', messageId: null});
    expect(session.snapshot()!.id).not.toBe(oldId);
    store.save.mockResolvedValue(undefined);
    await session.flush();
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({id: oldId, messageId: 'previous-card', endReason: 'stopped'}));
  });

  it('keeps one session while the queue is idle and starts a new session after disconnect', async () => {
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    const id = session.snapshot()!.id;
    await session.setMessage('text', 'player-message');
    session.endTrack('completed');
    session.startTrack({...song, title: 'Later song'}, 'voice', 2);
    expect(session.snapshot()!.id).toBe(id);
    expect(session.snapshot()!.messageId).toBe('player-message');

    session.finish('disconnected');
    const finished = session.snapshot()!;
    expect(finished.endedAt).toBeInstanceOf(Date);
    expect(finished.endReason).toBe('disconnected');
    expect(finished.entries.map(entry => entry.status)).toEqual(['completed', 'disconnected']);
    session.startTrack(song, 'new-voice', 3);
    expect(session.snapshot()!.id).not.toBe(id);
    expect(session.snapshot()!.voiceChannelId).toBe('new-voice');
    expect(session.snapshot()!.messageId).toBeNull();
    expect(session.snapshot()!.entries).toHaveLength(1);
    await session.flush();
  });

  it('serializes immutable state changes and avoids writes for repeated terminal events', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const saved: Array<{entries: string[]; ended: boolean; messageId: string | null}> = [];
    const store = {save: vi.fn(async record => {
      if (saved.length === 0) {
        await blocked;
      }
      saved.push({entries: record.entries.map(entry => entry.status), ended: Boolean(record.endedAt), messageId: record.messageId});
    })};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    session.endTrack('completed');
    session.endTrack('completed');
    session.startTrack(song, 'voice', 2);
    session.finish('stopped');
    session.finish('stopped');
    await Promise.resolve();
    expect(store.save).toHaveBeenCalledOnce();
    release();
    await session.flush();
    expect(saved).toEqual([
      {entries: ['playing'], ended: false, messageId: null},
      {entries: ['completed'], ended: false, messageId: null},
      {entries: ['completed', 'playing'], ended: false, messageId: null},
      {entries: ['completed', 'stopped'], ended: true, messageId: null},
    ]);
    await session.setMessage('text', 'player-message');
    await session.setMessage('text', 'player-message');
    expect(store.save).toHaveBeenCalledTimes(5);
  });

  it('retries a transient failed write during flush without requiring another playback event', async () => {
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    const original = session.snapshot()!;
    await expect(session.flush()).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenNthCalledWith(1, original);
    expect(store.save).toHaveBeenNthCalledWith(2, original);
    expect(session.snapshot()!.entries[0].status).toBe('playing');
    await session.flush();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('surfaces sustained failures after one retry and allows a later flush to recover', async () => {
    const error = new Error('disk full');
    const store = {save: vi.fn().mockRejectedValue(error)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    await expect(session.flush()).rejects.toBe(error);
    expect(store.save).toHaveBeenCalledTimes(2);
    await expect(session.flush()).rejects.toBe(error);
    expect(store.save).toHaveBeenCalledTimes(3);

    store.save.mockResolvedValue(undefined);
    await expect(session.flush()).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalledTimes(4);
    session.endTrack('completed');
    await expect(session.flush()).resolves.toBeUndefined();
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({
      entries: [expect.objectContaining({status: 'completed'})],
    }));
  });

  it('recovers the exact failed terminal record after a different session has started', async () => {
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValue(undefined)};
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    session.finish('stopped');
    const stopped = session.snapshot()!;
    session.startTrack(song, 'voice', 2);
    const current = session.snapshot()!;
    await expect(session.flush()).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalledTimes(5);
    expect(store.save).toHaveBeenNthCalledWith(2, stopped);
    expect(store.save).toHaveBeenNthCalledWith(3, stopped);
    expect(store.save).toHaveBeenNthCalledWith(4, current);
    expect(store.save).toHaveBeenNthCalledWith(5, stopped);
    expect(session.snapshot()).toEqual(current);
    await session.flush();
    expect(store.save).toHaveBeenCalledTimes(5);
  });

  it('does not retry an older failed snapshot after a newer snapshot saves successfully', async () => {
    const error = new Error('SQLite is busy');
    const store = {save: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    session.endTrack('completed');
    const completed = session.snapshot()!;
    await expect(session.flush()).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenLastCalledWith(completed);
  });

  it('serializes a new state change behind an in-flight retry', async () => {
    let beginRetry!: () => void;
    let releaseRetry!: () => void;
    const retryStarted = new Promise<void>(resolve => { beginRetry = resolve; });
    const retryBlocked = new Promise<void>(resolve => { releaseRetry = resolve; });
    const store = {save: vi.fn()
      .mockRejectedValueOnce(new Error('SQLite is busy'))
      .mockImplementationOnce(async () => {
        beginRetry();
        await retryBlocked;
      })
      .mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    const flushing = session.flush();
    await retryStarted;
    session.endTrack('completed');
    expect(store.save).toHaveBeenCalledTimes(2);
    releaseRetry();
    await flushing;
    await session.flush();
    expect(store.save.mock.calls.map(([record]) => record.entries[0].status)).toEqual([
      'playing', 'playing', 'completed',
    ]);
  });

  it('keeps a terminal failure visible even when a different session saves successfully', async () => {
    const error = new Error('disk full');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = {save: vi.fn(async record => {
      if (record.endedAt) {
        throw error;
      }
    })};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    session.finish('stopped');
    session.startTrack(song, 'voice', 2);
    await expect(session.flush()).rejects.toBe(error);
    expect(store.save).toHaveBeenCalledTimes(5);
  });

  it('retries a transient final write without any later command or flush', async () => {
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    await session.flush();
    store.save.mockRejectedValueOnce(new Error('SQLite is busy'));
    session.finish('disconnected');
    const finished = session.snapshot()!;
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledTimes(3));
    expect(store.save).toHaveBeenNthCalledWith(2, finished);
    expect(store.save).toHaveBeenNthCalledWith(3, finished);
    expect(finished).toMatchObject({endReason: 'disconnected', entries: [expect.objectContaining({status: 'disconnected'})]});
  });

  it('reports a sustained final-write failure safely without an unhandled rejection or endless retries', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = {save: vi.fn().mockResolvedValue(undefined)};
    const session = new ListeningSession('guild', store);
    session.startTrack(song, 'voice', 1);
    await session.flush();
    const error = new Error('Failure with private token=do-not-log');
    store.save.mockRejectedValue(error);
    session.finish('stopped');
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith('Could not persist listening session history for guild guild.');
    expect(JSON.stringify(log.mock.calls)).not.toContain('do-not-log');
    expect(store.save).toHaveBeenCalledTimes(3);
    await expect(session.flush()).rejects.toBe(error);
    expect(store.save).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledOnce();
  });
});
