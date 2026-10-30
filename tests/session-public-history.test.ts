import 'reflect-metadata';
import {ChannelType, Collection} from 'discord.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ListeningSessionRecord} from '../src/services/listening-session.js';
import {MediaSource, STATUS} from '../src/services/player-types.js';
import {sessionButtonId} from '../src/utils/build-session-message.js';

vi.mock('../src/services/session-history-store.js', () => ({default: class {}}));
vi.mock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: async () => ({defaultQueuePageSize: 10})}));

import SessionPlayer from '../src/services/session-player.js';

const sessionId = 'f4d70da3-1b9f-4e13-a962-2156db953d73';
const historyEntries = (count: number, ended = true): ListeningSessionRecord['entries'] => Array.from({length: count}, (_, index) => ({
  id: `entry-${index + 1}`,
  title: `History track ${String(index + 1).padStart(4, '0')} ${'a'.repeat(65)}`,
  artist: 'Artist', url: 'abcdefghijk', source: 'Youtube', length: 180, offset: 0,
  requestedBy: 'listener', startedAt: new Date('2026-10-24T12:00:00Z'),
  endedAt: ended || index + 1 < count ? new Date('2026-10-24T12:03:00Z') : null,
  status: !ended && index + 1 === count ? 'playing' : index === 4 ? 'skipped' : 'completed',
}));

type PayloadBody = {content?: string; embeds?: Array<{toJSON?: () => object; description?: string}>; components?: unknown[]; allowedMentions?: object; nonce?: string; enforce_nonce?: boolean};
type Payload = PayloadBody & {body?: PayloadBody; options?: PayloadBody};
const plainPayload = (payload: Payload) => JSON.parse(JSON.stringify(payload.body ?? payload.options ?? payload)) as {
  content: string; embeds: Array<{description?: string}>; components: unknown[]; nonce?: string; enforce_nonce?: boolean;
};

const fixture = (count = 180, ended = true) => {
  const record: ListeningSessionRecord = {
    id: sessionId, guildId: 'guild', voiceChannelId: 'voice', channelId: 'private-channel', messageId: null,
    startedAt: new Date('2026-10-24T12:00:00Z'), endedAt: ended ? new Date('2026-10-24T13:00:00Z') : null,
    endReason: ended ? 'stopped' : null, entries: historyEntries(count, ended),
  };
  const state = {record, updater: undefined as undefined | (() => Promise<void>)};
  const records = new Map([[sessionId, structuredClone(record)]]);
  const pending = new Set(ended ? [sessionId] : []);
  const bindings = new Map<number, string>();
  const intents = new Map<number, string>();
  const nonces = new Map<number, string>();
  const events: string[] = [];
  type FakeMessage = ReturnType<typeof plainPayload> & {
    id: string; channelId: string; author: {id: string}; edit: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>;
  };
  const messages = new Map<string, FakeMessage>();
  let sequence = 0;
  const channel = {
    id: 'private-channel', type: ChannelType.GuildText, guild: {id: 'guild'},
    isTextBased: () => true, isThread: () => false, permissionsFor: () => ({has: () => true}),
    messages: {fetch: vi.fn(async ({message, limit = 50, before}: {message?: string; force?: boolean; limit?: number; before?: string; cache?: boolean}) => {
      if (message) {
        const found = messages.get(message);
        if (!found) throw {code: 10008};
        return found;
      }

      return new Collection([...messages]
        .filter(([id]) => !before || BigInt(id) < BigInt(before))
        .sort(([left], [right]) => BigInt(left) > BigInt(right) ? -1 : 1)
        .slice(0, limit));
    })},
    send: vi.fn(async (payload: Payload) => {
      const id = String(100_000 + ++sequence);
      const message: FakeMessage = {
        ...plainPayload(payload), id, channelId: 'private-channel', author: {id: 'bot'},
        edit: vi.fn(async (updated: Payload) => { Object.assign(message, plainPayload(updated)); return message; }),
        delete: vi.fn(async () => { messages.delete(id); }),
      };
      messages.set(id, message);
      events.push(`send:${id}`);
      return message;
    }),
    client: {channels: {fetch: vi.fn()}, rest: {get: vi.fn()}, user: {id: 'bot'}},
  };
  channel.client.channels.fetch.mockImplementation(async (id: string) => id === channel.id ? channel : null);
  const publicChannel = {...channel, id: 'public-channel', send: vi.fn()};
  const controller = {
    snapshot: () => structuredClone(state.record), flush: vi.fn().mockResolvedValue(undefined),
    setChannel: (id: string) => { state.record.channelId ??= id; },
    setMessage: vi.fn(async (channelId: string, messageId: string) => {
      Object.assign(state.record, {channelId, messageId});
      records.set(sessionId, structuredClone(state.record));
    }),
  };
  const player = {
    guildId: 'guild', listeningSession: controller, status: STATUS.PLAYING,
    getCurrent: vi.fn(() => ended ? null : ({...state.record.entries.at(-1)!, source: MediaSource.Youtube, isLive: false})),
    getQueue: () => [], queueSize: () => 0, getPosition: () => 30, getVolume: () => 100,
    canGoBack: () => true, canGoForward: () => false, isQueueEmpty: () => true,
    refreshPlayingMessage: vi.fn(),
    setPlayingMessageUpdater: vi.fn((updater: () => Promise<void>) => { state.updater = updater; }),
  };
  const manager = {getExisting: vi.fn(() => ended ? undefined : player)};
  const store = {
    load: vi.fn(async (id: string, guild: string) => guild === 'guild' ? structuredClone(records.get(id) ?? null) : null),
    interruptOpenSessions: vi.fn(async () => [...pending].map(id => structuredClone(records.get(id)!))),
    save: vi.fn(async (saved: ListeningSessionRecord) => { records.set(saved.id, structuredClone(saved)); }),
    markRecovered: vi.fn(async (id: string) => { pending.delete(id); events.push('ack'); }),
    loadHistoryMessages: vi.fn(async () => [...new Set([...bindings.keys(), ...intents.keys()])].sort((left, right) => left - right)
      .map(position => ({position, messageId: bindings.get(position) ?? null, afterMessageId: intents.get(position) ?? null, nonce: nonces.get(position) ?? null}))),
    beginHistoryMessage: vi.fn(async (_id: string, position: number, afterMessageId: string, nonce: string) => {
      intents.set(position, afterMessageId); nonces.set(position, nonce); bindings.delete(position); events.push(`intent:${position}`);
    }),
    saveHistoryMessage: vi.fn(async (_id: string, position: number, messageId: string) => {
      bindings.set(position, messageId); intents.delete(position); nonces.delete(position); events.push(`bind:${position}`);
    }),
    deleteHistoryMessage: vi.fn(async (_id: string, position: number) => { bindings.delete(position); intents.delete(position); nonces.delete(position); }),
  };
  const service = new SessionPlayer(manager as never, store as never);
  return {state, records, pending, bindings, intents, nonces, events, messages, channel, publicChannel, controller, player, manager, store, service};
};

const expectCompleteHistory = (payloads: Payload[], count: number) => {
  const lines = payloads.flatMap(payload => plainPayload(payload).embeds.flatMap(embed => (embed.description ?? '').split('\n')));
  const entries = lines.flatMap(line => {
    const match = /^(\d+)\. \[History track (\d{4}) /.exec(line);
    return match ? [{position: Number(match[1]), track: Number(match[2])}] : [];
  });
  expect(entries).toEqual(Array.from({length: count}, (_, index) => ({position: index + 1, track: index + 1})));
  expect(lines.some(line => line.includes('Skipped'))).toBe(true);
};

afterEach(() => { vi.restoreAllMocks(); });

describe('public session history integration', () => {
  it('recovers every track publicly in the original channel before acknowledging the recap', async () => {
    const f = fixture();
    await f.service.prepareRecovery();
    await f.service.recover(f.channel.client as never);
    expect(f.channel.client.channels.fetch).toHaveBeenCalledWith('private-channel');
    expect(f.publicChannel.send).not.toHaveBeenCalled();
    expect(f.messages.size).toBeGreaterThan(3);
    expect(f.bindings.size).toBe(f.messages.size - 1);
    expectCompleteHistory([...f.messages.values()], 180);
    expect([...f.messages.values()].every(message => message.components.length === 0)).toBe(true);
    expect(f.events.at(-1)).toBe('ack');
    expect(f.events.filter(event => event.startsWith('bind:'))).toHaveLength(f.bindings.size);
    expect(f.pending.size).toBe(0);
    for (const [index, [payload]] of f.channel.send.mock.calls.slice(1).entries()) {
      const body = plainPayload(payload);
      expect(body.enforce_nonce).toBe(true);
      expect(body.nonce).toMatch(/^[a-f0-9]{24}$/);
      expect(f.store.beginHistoryMessage.mock.calls[index][3]).toBe(body.nonce);
    }
  });

  it.each(['send', 'binding'] as const)('keeps recovery pending after an overflow %s failure and reuses published chunks on restart', async failure => {
    const f = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    if (failure === 'send') {
      const send = f.channel.send.getMockImplementation()!;
      f.channel.send.mockImplementation(async payload => {
        if (f.channel.send.mock.calls.length === 3) throw new Error('Discord unavailable');
        return send(payload);
      });
    } else {
      const bind = f.store.saveHistoryMessage.getMockImplementation()!;
      let failed = false;
      f.store.saveHistoryMessage.mockImplementation(async (id, position, messageId) => {
        if (position === 2 && !failed) { failed = true; throw new Error('SQLite busy'); }
        await bind(id, position, messageId);
      });
    }
    await f.service.prepareRecovery();
    await f.service.recover(f.channel.client as never);
    expect(f.pending.has(sessionId)).toBe(true);
    expect(f.store.markRecovered).not.toHaveBeenCalled();
    expect(f.messages.size).toBe(failure === 'binding' ? 3 : 2);
    expect(f.bindings.size).toBe(1);
    const mainId = f.records.get(sessionId)!.messageId;
    const firstOverflowId = f.bindings.get(1)!;
    const acceptedPendingId = failure === 'binding' ? [...f.messages.keys()].at(-1) : undefined;
    const pendingNonce = f.nonces.get(2);
    expect(pendingNonce).toMatch(/^[a-f0-9]{24}$/);

    const restarted = new SessionPlayer(f.manager as never, f.store as never);
    await restarted.prepareRecovery();
    await restarted.recover(f.channel.client as never);
    expect(f.records.get(sessionId)!.messageId).toBe(mainId);
    expect(f.bindings.get(1)).toBe(firstOverflowId);
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({message: firstOverflowId, force: true});
    expect(f.messages.size).toBe(f.bindings.size + 1);
    expectCompleteHistory([...f.messages.values()], 180);
    expect(f.store.markRecovered).toHaveBeenCalledOnce();
    expect(f.events.at(-1)).toBe('ack');
    expect(f.pending.size).toBe(0);
    expect(f.store.beginHistoryMessage.mock.calls.filter(([, position]) => position === 2)).toHaveLength(1);
    expect(f.channel.send.mock.calls.map(([payload]) => plainPayload(payload).nonce).filter(nonce => nonce === pendingNonce))
      .toHaveLength(failure === 'binding' ? 1 : 2);
    if (acceptedPendingId) {
      expect(f.bindings.get(2)).toBe(acceptedPendingId);
      expect(f.messages.get(acceptedPendingId)!.delete).not.toHaveBeenCalled();
    }
  });

  it.each(['lost send response', 'failed binding'] as const)('reconciles a saved send intent after restart following a %s', async failure => {
    const f = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const send = f.channel.send.getMockImplementation()!;
    f.channel.send.mockImplementation(async payload => {
      const message = await send(payload);
      if (f.channel.send.mock.calls.length === 2 && failure === 'lost send response') {
        throw new Error('Connection closed after Discord accepted the message');
      }

      return message;
    });
    if (failure === 'failed binding') {
      f.store.saveHistoryMessage.mockRejectedValueOnce(new Error('SQLite busy'));
    }

    await f.service.prepareRecovery();
    await f.service.recover(f.channel.client as never);
    expect(f.messages.size).toBe(2);
    const originalOverflowId = [...f.messages.keys()][1];
    expect(f.messages.get(originalOverflowId)!.delete).not.toHaveBeenCalled();
    expect(f.intents.get(1)).toBe(f.records.get(sessionId)!.messageId);
    expect(f.bindings.size).toBe(0);
    expect(f.events.indexOf('intent:1')).toBeLessThan(f.events.indexOf(`send:${originalOverflowId}`));
    expect(f.pending.has(sessionId)).toBe(true);
    expect(f.store.markRecovered).not.toHaveBeenCalled();

    const restarted = new SessionPlayer(f.manager as never, f.store as never);
    await restarted.prepareRecovery();
    await restarted.recover(f.channel.client as never);
    expect(f.bindings.get(1)).toBe(originalOverflowId);
    expect(f.messages.size).toBe(f.bindings.size + 1);
    expect(f.channel.send).toHaveBeenCalledTimes(f.messages.size);
    expectCompleteHistory([...f.messages.values()], 180);
    expect(f.intents.size).toBe(0);
    expect(f.pending.size).toBe(0);
    expect(f.store.markRecovered).toHaveBeenCalledOnce();
  });

  it('does not resend or acknowledge an unresolved intent when Discord returns empty history', async () => {
    const f = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const send = f.channel.send.getMockImplementation()!;
    f.channel.send.mockImplementation(async payload => {
      const message = await send(payload);
      if (f.channel.send.mock.calls.length === 2) throw new Error('Connection closed after Discord accepted the message');
      return message;
    });
    await f.service.prepareRecovery();
    await f.service.recover(f.channel.client as never);
    expect(f.messages.size).toBe(2);
    expect(f.intents.has(1)).toBe(true);

    const fetch = f.channel.messages.fetch.getMockImplementation()!;
    f.channel.messages.fetch.mockImplementation(async options => options.message ? fetch(options) : new Collection());
    const restarted = new SessionPlayer(f.manager as never, f.store as never);
    await restarted.prepareRecovery();
    await restarted.recover(f.channel.client as never);
    expect(f.channel.send).toHaveBeenCalledTimes(2);
    expect(f.messages.size).toBe(2);
    expect(f.pending.has(sessionId)).toBe(true);
    expect(f.intents.has(1)).toBe(true);
    expect(f.store.markRecovered).not.toHaveBeenCalled();
  });

  it('serializes queue completion and concurrent publication without duplicating continuation messages', async () => {
    const f = fixture(120, false);
    const firstLink = await f.service.ensureMessage(f.player as never, f.channel as never);
    const updater = f.state.updater!;
    expect(f.messages.size).toBe(1);
    expect(f.bindings.size).toBe(0);
    f.state.record.entries = historyEntries(300);
    f.player.getCurrent.mockReturnValue(null);
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const sending = new Promise<void>(resolve => { started = resolve; });
    const send = f.channel.send.getMockImplementation()!;
    let activeSends = 0;
    let peakSends = 0;
    let shouldBlock = true;
    f.channel.send.mockImplementation(async payload => {
      activeSends++;
      peakSends = Math.max(peakSends, activeSends);
      if (shouldBlock) { shouldBlock = false; started(); await blocked; }
      const message = await send(payload);
      activeSends--;
      return message;
    });
    const updating = updater();
    await sending;
    const republishing = f.service.ensureMessage(f.player as never, f.publicChannel as never, sessionId);
    const updatingAgain = updater();
    // Let both competing calls reach their first waits while one send remains
    // blocked; otherwise scheduling luck can hide duplicate publication races.
    await new Promise<void>(resolve => { setImmediate(resolve); });
    release();
    const [, nextLink] = await Promise.all([updating, republishing, updatingAgain]);
    expect(nextLink).toBe(firstLink);
    expect(peakSends).toBe(1);
    expect(f.publicChannel.send).not.toHaveBeenCalled();
    expect(f.messages.size).toBe(f.bindings.size + 1);
    expect(new Set(f.bindings.values()).size).toBe(f.bindings.size);
    expect(f.channel.send).toHaveBeenCalledTimes(f.messages.size);
    expectCompleteHistory([...f.messages.values()], 300);
  });

  it('hides recap continuations when playback resumes and restores the complete history at the next queue end', async () => {
    const f = fixture(120, false);
    const current = f.player.getCurrent();
    await f.service.ensureMessage(f.player as never, f.channel as never);
    const primaryId = f.state.record.messageId!;
    const updater = f.state.updater!;
    f.player.getCurrent.mockReturnValue(null);
    f.state.record.entries = historyEntries(120);
    await updater();
    expect(f.bindings.size).toBeGreaterThan(0);
    expectCompleteHistory([...f.messages.values()], 120);

    f.player.getCurrent.mockReturnValue(current);
    f.state.record.entries = historyEntries(121, false);
    await updater();
    expect(f.messages.size).toBe(1);
    expect(f.bindings.size).toBe(0);
    expect(f.messages.get(primaryId)!.embeds).toHaveLength(1);
    expect(f.messages.get(primaryId)!.embeds[0].title).toContain('Now Playing');
    expect(f.state.record.entries).toHaveLength(121);

    f.player.getCurrent.mockReturnValue(null);
    f.state.record.entries = historyEntries(121);
    await updater();
    expect(f.state.record.messageId).toBe(primaryId);
    expectCompleteHistory([...f.messages.values()], 121);
  });

  it('answers a legacy history button with every chunk using follow-ups instead of page clicks', async () => {
    const f = fixture();
    const member = {id: 'listener', voice: {channelId: 'voice'}};
    const interaction = {
      customId: sessionButtonId(sessionId, 'history', 37), channelId: f.channel.id, user: {id: 'listener'},
      guild: {
        id: 'guild', channels: {fetch: vi.fn().mockResolvedValue(f.channel)}, roles: {fetch: vi.fn().mockResolvedValue(undefined)},
        members: {fetch: vi.fn().mockResolvedValue(member), cache: new Collection([['listener', member]])},
      },
      deferReply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(undefined), followUp: vi.fn().mockResolvedValue(undefined),
    };
    await f.service.handleButton(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: true});
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(interaction.followUp.mock.calls.length).toBeGreaterThan(2);
    const payloads = [interaction.editReply.mock.calls[0][0], ...interaction.followUp.mock.calls.map(([payload]) => payload)];
    expectCompleteHistory(payloads, 180);
    expect(payloads.every(payload => payload.components.length === 0)).toBe(true);
    expect(interaction.followUp.mock.calls.every(([payload]) => payload.ephemeral === true)).toBe(true);
  });
});
