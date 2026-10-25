import {describe, expect, it} from 'vitest';
import type Player from '../src/services/player.js';
import {MediaSource, STATUS, type QueuedSong} from '../src/services/player-types.js';
import type {ListeningSessionRecord} from '../src/services/listening-session.js';
import {buildHistoryMessages, buildQueueMessage, buildSessionMessage, buildSessionMessages, type SessionMessagePayload} from '../src/utils/build-session-message.js';

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

const embedTextLength = (embed: ReturnType<SessionMessagePayload['embeds'][number]['toJSON']>) =>
  (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0)
  + (embed.author?.name.length ?? 0) + (embed.fields ?? []).reduce((length, field) => length + field.name.length + field.value.length, 0);

const historyLines = (messages: SessionMessagePayload[]) => messages.flatMap(message => message.embeds
  .filter(embed => !['Now playing', 'Paused'].includes(embed.data.title ?? ''))
  .flatMap(embed => (embed.data.description ?? '').split('\n').filter(line => /^\d+\. /.test(line))));

const expectBoundedMessages = (messages: SessionMessagePayload[]) => {
  expect(messages.length).toBeGreaterThan(0);
  for (const [index, message] of messages.entries()) {
    expect(message.embeds.length).toBeLessThanOrEqual(10);
    const embeds = message.embeds.map(embed => embed.toJSON());
    expect(embeds.reduce((length, embed) => length + embedTextLength(embed), 0)).toBeLessThanOrEqual(6000);
    for (const embed of embeds) expect(embed.description!.length).toBeLessThanOrEqual(4096);
    expect(message.allowedMentions).toEqual({parse: []});
    expect(message.components.flatMap(row => row.components).every(button => !button.custom_id.includes(':history:'))).toBe(true);
    if (index > 0) {
      expect(message.components).toEqual([]);
      expect(embeds[0].title).toBe('Session history (continued)');
    }
  }
};

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
      ...buildHistoryMessages(session),
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

    const description = buildHistoryMessages(session)[0].embeds[0].toJSON().description!;

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

describe('complete public listening history', () => {
  it.each([false, true])('shows six short tracks in one message, including when the session has ended: %s', ended => {
    const tracks = Array.from({length: 6}, (_, index) => ({...makeTrack(`https://music.example/${index}`), title: `Track ${index + 1}`}));
    const session = makeSession(tracks);
    if (ended) session.endedAt = new Date('2026-10-24T12:30:00Z');
    const messages = buildSessionMessages(session);

    expect(messages).toHaveLength(1);
    expectBoundedMessages(messages);
    expect(historyLines(messages).map(line => Number(line.match(/^\d+/)![0]))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(messages[0].components).toEqual([]);
    expect(JSON.stringify(messages)).not.toContain('View full history');
  });

  it('keeps every played track visible next to the live player without adding a history control', () => {
    const tracks = Array.from({length: 6}, (_, index) => ({...makeTrack(`https://music.example/${index}`), title: `Track ${index + 1}`}));
    const session = makeSession(tracks);
    const messages = buildSessionMessages(session, makePlayer(tracks));

    expect(messages).toHaveLength(1);
    expect(messages[0].embeds[0].data.title).toBe('Now playing');
    expect(messages[0].embeds[1].data.title).toBe('Session history');
    expect(historyLines(messages)).toHaveLength(6);
    expect(messages[0].components.flatMap(row => row.components).map(button => button.label)).toEqual(['Previous', 'Pause', 'Next', 'Queue', 'More']);
    expectBoundedMessages(messages);
  });

  it('retains all long Unicode entries and their statuses in chronological order without splitting entry lines', () => {
    const tracks = Array.from({length: 125}, (_, index) => ({
      ...makeTrack(`https://music.example/${'漢'.repeat(150)}/${index}`),
      title: `Track${index + 1} ${'🎧漢字_*()'.repeat(40)}`,
    }));
    const session = makeSession(tracks);
    session.entries[17].status = 'skipped';
    session.entries[93].status = 'stopped';
    session.endedAt = new Date('2026-10-24T14:00:00Z');
    const original = structuredClone(session);
    const messages = buildSessionMessages(session);
    const lines = historyLines(messages);

    expect(messages.length).toBeGreaterThan(1);
    expectBoundedMessages(messages);
    expect(lines).toHaveLength(125);
    for (const [index, line] of lines.entries()) {
      expect(line).toMatch(new RegExp(`^${index + 1}\\. Track${index + 1} `));
      expect(line).toMatch(/ — (Played|Skipped|Stopped)$/);
    }
    expect(lines[17]).toContain('Skipped');
    expect(lines[93]).toContain('Stopped');
    expect(session).toEqual(original);
  });

  it('uses the available embed budget before continuing in another message and accounts for player titles and footers', () => {
    const tracks = Array.from({length: 80}, (_, index) => ({
      ...makeTrack(`https://music.example/${'x'.repeat(250)}/${index}`),
      title: `Track${index + 1} ${'*_~|'.repeat(80)}`,
      artist: 'Artist'.repeat(100),
    }));
    const session = makeSession(tracks);
    const messages = buildSessionMessages(session, makePlayer(tracks));

    expect(messages.length).toBeGreaterThan(1);
    expectBoundedMessages(messages);
    expect(historyLines(messages).map(line => Number(line.match(/^\d+/)![0]))).toEqual(Array.from({length: 80}, (_, index) => index + 1));
    for (const [index, current] of messages.slice(0, -1).entries()) {
      const nextLine = historyLines([messages[index + 1]])[0];
      const embeds = current.embeds.map(embed => embed.toJSON());
      const totalText = embeds.reduce((length, embed) => length + embedTextLength(embed), 0);
      const lastDescription = embeds.at(-1)!.description!;
      const canAppendToLast = lastDescription.length + 1 + nextLine.length <= 4096 && totalText + 1 + nextLine.length <= 6000;
      const canAddEmbed = embeds.length < 10 && totalText + 'Session history (continued)'.length + nextLine.length <= 6000;
      expect(canAppendToLast || canAddEmbed).toBe(false);
    }
  });

  it('uses multiple embeds within one message when description length requires it but the message still has room', () => {
    const tracks = Array.from({length: 100}, (_, index) => ({...makeTrack(`https://music.example/${index}`), title: `Song ${index + 1}`}));
    const session = makeSession(tracks);
    const messages = buildHistoryMessages(session);

    expect(messages).toHaveLength(1);
    expect(messages[0].embeds).toHaveLength(2);
    expect(historyLines(messages)).toHaveLength(100);
    expectBoundedMessages(messages);
  });

  it('returns full history without pagination controls for legacy history-button callers', () => {
    const tracks = Array.from({length: 150}, (_, index) => ({...makeTrack(`https://music.example/${index}`), title: `Track ${index + 1}`}));
    const messages = buildHistoryMessages(makeSession(tracks));

    expect(historyLines(messages)).toHaveLength(150);
    expect(messages.every(message => message.components.length === 0)).toBe(true);
    expectBoundedMessages(messages);
  });

  it('always returns a recap for an empty session', () => {
    const session = makeSession([]);
    const messages = buildSessionMessages(session);
    expect(messages).toHaveLength(1);
    expect(messages[0].embeds[0].data.description).toContain('No tracks played.');
    expectBoundedMessages(messages);
    expect(buildHistoryMessages(session)[0].embeds[0].data.description).toBe('No tracks played.');
  });
});
