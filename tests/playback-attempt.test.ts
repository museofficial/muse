import {describe, expect, it} from 'vitest';
import {PlaybackAttemptTracker} from '../src/services/playback-attempt.js';

type Song = {title: string};
type Connection = {name: string};

describe('PlaybackAttemptTracker', () => {
  it('makes only the newest token latest and invalidates outstanding work', () => {
    const tracker = new PlaybackAttemptTracker<Song, Connection>(() => ({
      currentSong: null,
      queueEntryVersion: null,
      currentConnection: null,
    }));

    const first = tracker.begin();
    const second = tracker.begin();

    expect(second.id).toBeGreaterThan(first.id);
    expect(tracker.latest()).toBe(second);
    expect(tracker.isLatest(first)).toBe(false);
    expect(tracker.isLatest(second)).toBe(true);
    expect(tracker.isLatest({id: second.id})).toBe(true);

    tracker.invalidate();

    expect(tracker.isLatest(second)).toBe(false);
    expect(tracker.latest().id).toBeGreaterThan(second.id);
  });

  it('requires the token and exact current connection for current ownership', () => {
    const connection = {name: 'current'};
    let currentConnection: Connection | null = connection;
    const tracker = new PlaybackAttemptTracker<Song, Connection>(() => ({
      currentSong: null,
      queueEntryVersion: null,
      currentConnection,
    }));
    const attempt = tracker.begin();

    expect(tracker.isCurrent(attempt, connection)).toBe(true);
    expect(tracker.isCurrent(attempt, {name: 'current'})).toBe(false);

    currentConnection = {name: 'replacement'};
    expect(tracker.isCurrent(attempt, connection)).toBe(false);
  });

  it('captures typed ownership and rejects song, entry, connection, and token drift', () => {
    const firstSong = {title: 'first'};
    const firstConnection = {name: 'first'};
    let owner = {
      currentSong: firstSong as Song | null,
      queueEntryVersion: 4 as number | null,
      currentConnection: firstConnection as Connection | null,
    };
    const tracker = new PlaybackAttemptTracker<Song, Connection>(() => owner);
    const attempt = tracker.begin();
    const context = tracker.capture(attempt, firstSong, 4, firstConnection);

    expect(context).toEqual({
      attempt,
      song: firstSong,
      queueEntryVersion: 4,
      connection: firstConnection,
    });
    expect(tracker.owns(context)).toBe(true);

    owner = {...owner, currentSong: {title: 'replacement'}};
    expect(tracker.owns(context)).toBe(false);
    owner = {...owner, currentSong: firstSong, queueEntryVersion: 5};
    expect(tracker.owns(context)).toBe(false);
    owner = {...owner, queueEntryVersion: 4, currentConnection: {name: 'replacement'}};
    expect(tracker.owns(context)).toBe(false);
    owner = {...owner, currentConnection: firstConnection};
    tracker.begin();
    expect(tracker.owns(context)).toBe(false);
  });
});
