import {describe, expect, it} from 'vitest';
import type Player from '../src/services/player.js';
import {MediaSource, STATUS, type QueuedSong} from '../src/services/player-types.js';
import type {ListeningSessionRecord} from '../src/services/listening-session.js';
import {buildHistoryMessage, buildQueueMessage, buildSessionMessage} from '../src/utils/build-session-message.js';

const makeTrack = (url: string): QueuedSong => ({
  title: '*_~|'.repeat(60),
  artist: 'Artist',
  url,
  source: MediaSource.HLS,
  offset: 0,
  length: 180,
  isLive: false,
  playlist: null,
  thumbnailUrl: null,
  requestedBy: 'listener',
  addedInChannelId: 'channel',
});

const makeSession = (tracks: QueuedSong[]): ListeningSessionRecord => ({
  id: 'session-id',
  guildId: 'guild-id',
  voiceChannelId: 'voice-id',
  channelId: 'channel-id',
  messageId: 'message-id',
  startedAt: new Date('2026-10-24T12:00:00Z'),
  endedAt: null,
  endReason: null,
  entries: tracks.map((track, index) => ({
    ...track,
    id: `entry-${index}`,
    source: 'HLS',
    startedAt: new Date('2026-10-24T12:00:00Z'),
    endedAt: new Date('2026-10-24T12:03:00Z'),
    status: 'completed',
  })),
});

const makePlayer = (tracks: QueuedSong[], overrides: object = {}) => ({
  getCurrent: () => tracks[0],
  getQueue: () => tracks,
  getPosition: () => 30,
  getVolume: () => 100,
  canGoBack: () => false,
  canGoForward: () => true,
  status: STATUS.PLAYING,
  loopCurrentSong: false,
  loopCurrentQueue: false,
  ...overrides,
}) as unknown as Player;

describe('session message URL limits', () => {
  it('bounds encoded links in live cards, recaps, full history, and queues', () => {
    const url = `https://radio.example/${'()'.repeat(130)}`;
    expect(url.length).toBeLessThanOrEqual(300);
    expect(new URL(url).href.replace(/\(/g, '%28').replace(/\)/g, '%29').length).toBeGreaterThan(300);
    const tracks = Array.from({length: 5}, () => makeTrack(url));
    const session = makeSession(tracks);
    const player = makePlayer(tracks);

    const messages = [
      buildSessionMessage(session, player),
      buildSessionMessage(session),
      buildHistoryMessage(session),
      buildQueueMessage(session, player),
    ];

    for (const message of messages) {
      const description = message.embeds[0].toJSON().description!;
      expect(description.length).toBeLessThanOrEqual(4096);
      expect(description).not.toContain('https://radio.example/');
      expect(description).toContain('\\*');
    }
    expect(tracks.every(track => track.url === url)).toBe(true);
  });

  it('keeps shorter links and encodes parentheses without changing playback URLs', () => {
    const track = makeTrack('https://radio.example/(live)');
    const session = makeSession([track]);

    const description = buildHistoryMessage(session).embeds[0].toJSON().description!;

    expect(description).toContain('https://radio.example/%28live%29');
    expect(track.url).toBe('https://radio.example/(live)');
  });
});

describe('session loop indicators', () => {
  it.each([STATUS.PLAYING, STATUS.PAUSED])('shows enabled song and queue looping while %s', status => {
    const track = makeTrack('https://radio.example/live');
    const session = makeSession([track]);
    const render = (flags: object) => buildSessionMessage(session, makePlayer([track], {status, ...flags}))
      .embeds[0].toJSON().description!;

    expect(render({loopCurrentSong: true})).toContain('Loop: song');
    expect(render({loopCurrentQueue: true})).toContain('Loop: queue');
    expect(render({})).not.toContain('Loop:');
  });
});
