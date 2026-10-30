import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ChannelType, Collection, MessageFlags} from 'discord.js';
import {MediaSource, STATUS} from '../src/services/player-types.js';
import type {ListeningSessionRecord} from '../src/services/listening-session.js';
import {buildHistoryMessages, buildMoreMessage, buildQueueMessage, buildSessionMessage, buildSessionMessages, sessionButtonId} from '../src/utils/build-session-message.js';
import {buildQueueEmbed} from '../src/utils/build-embed.js';

const permission = vi.hoisted(() => vi.fn());
const guildSettings = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/can-use-playback-command.js', () => ({default: permission}));
vi.mock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: guildSettings}));
vi.mock('../src/services/session-history-store.js', () => ({default: class {}}));

import SessionPlayer from '../src/services/session-player.js';

const id = 'f4d70da3-1b9f-4e13-a962-2156db953d73';
const track = (title = 'First song') => ({
  title, url: 'abcdefghijk', artist: 'Artist', source: MediaSource.Youtube,
  offset: 0, length: 180, isLive: false, thumbnailUrl: null, requestedBy: 'listener', addedInChannelId: 'channel', playlist: null,
});
const record = (): ListeningSessionRecord => ({
  id, guildId: 'guild', voiceChannelId: 'voice', channelId: null, messageId: null,
  startedAt: new Date('2026-10-24T12:00:00Z'), endedAt: null, endReason: null,
  entries: [{...track(), id: 'entry', source: 'Youtube', startedAt: new Date('2026-10-24T12:00:00Z'), endedAt: null, status: 'playing'}],
});

const fixture = () => {
  const state = {record: record(), updater: undefined as undefined | (() => Promise<void>)};
  const records = new Map([[id, state.record]]);
  const card = {id: 'message', channelId: 'channel', content: '', edit: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined)};
  const member = {id: 'listener', voice: {channelId: 'voice'}};
  const channel = {
    id: 'channel', type: ChannelType.GuildText, guild: {id: 'guild'},
    isTextBased: () => true, isThread: () => false, permissionsFor: vi.fn(() => ({has: () => true})),
    messages: {fetch: vi.fn().mockResolvedValue(card)}, send: vi.fn().mockResolvedValue(card),
    client: {user: {id: 'bot'}, channels: {fetch: vi.fn()}, rest: {get: vi.fn()}},
  };
  channel.client.channels.fetch.mockResolvedValue(channel);
  const guild = {
    id: 'guild', channels: {fetch: vi.fn().mockResolvedValue(channel)}, roles: {fetch: vi.fn().mockResolvedValue(undefined)},
    members: {fetch: vi.fn().mockResolvedValue(member), cache: new Collection([['listener', member]])},
  };
  const controller = {
    snapshot: () => structuredClone(state.record), flush: vi.fn().mockResolvedValue(undefined),
    setChannel: vi.fn((channelId: string) => { state.record.channelId ??= channelId; }),
    setMessage: vi.fn(async (channelId: string, messageId: string) => Object.assign(state.record, {channelId, messageId})),
  };
  const player = {
    guildId: 'guild', listeningSession: controller, status: STATUS.PLAYING,
    voiceConnection: {joinConfig: {channelId: 'voice'}},
    getCurrent: vi.fn(() => track()), getQueue: vi.fn(() => [track('Next song')]), getPosition: () => 30,
    queueSize: vi.fn(() => 1),
    getVolume: () => 100, canGoBack: () => false, canGoForward: () => true, isQueueEmpty: () => false,
    back: vi.fn(), forward: vi.fn(), pause: vi.fn(), play: vi.fn(), stop: vi.fn(), shuffle: vi.fn(), seek: vi.fn(),
    refreshPlayingMessage: vi.fn(),
    setPlayingMessageUpdater: vi.fn((updater: () => Promise<void>) => { state.updater = updater; }),
  };
  const manager = {getExisting: vi.fn(() => player)};
  const store = {
    load: vi.fn(async (sessionId: string, guildId: string) => guildId === 'guild' ? records.get(sessionId) ?? null : null),
    interruptOpenSessions: vi.fn().mockResolvedValue([]),
    save: vi.fn(async (session: ListeningSessionRecord) => { records.set(session.id, session); }),
    markRecovered: vi.fn().mockResolvedValue(undefined),
    loadHistoryMessages: vi.fn().mockResolvedValue([]),
    saveHistoryMessage: vi.fn().mockResolvedValue(undefined),
    deleteHistoryMessage: vi.fn().mockResolvedValue(undefined),
  };
  const service = new SessionPlayer(manager as never, store as never);
  const interaction = (action: string, page = 0) => ({
    customId: sessionButtonId(id, action, page), guild, channelId: 'channel', user: {id: 'listener'},
    message: {id: 'private-controls', flags: {has: (flag: number) => flag === MessageFlags.Ephemeral}}, deferReply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(undefined), followUp: vi.fn().mockResolvedValue(undefined), deleteReply: vi.fn().mockResolvedValue(undefined),
  });
  return {state, records, card, member, channel, guild, controller, player, manager, store, service, interaction};
};

beforeEach(() => { vi.clearAllMocks(); permission.mockResolvedValue(true); guildSettings.mockResolvedValue({defaultQueuePageSize: 10}); });

describe('shared session card publication', () => {
  it('uses the configured classic queue page size on publication and later edits', async () => {
    const f = fixture();
    guildSettings.mockResolvedValue({defaultQueuePageSize: 2});
    f.player.getQueue.mockReturnValue([track('Second song'), track('Third song'), track('Fourth song')]);
    f.player.queueSize.mockReturnValue(3);
    await f.service.ensureMessage(f.player as never, f.channel as never);
    const initial = f.channel.send.mock.calls[0][0].embeds[0].data;
    expect(initial.description).toContain('Second song');
    expect(initial.description).toContain('Third song');
    expect(initial.description).not.toContain('Fourth song');
    expect(initial.fields.map(field => field.name)).toEqual(['In queue', 'Total length']);
    await f.state.updater!();
    expect(f.card.edit.mock.calls.at(-1)![0].embeds[0].data).toEqual(initial);
    expect(guildSettings).toHaveBeenCalledOnce();
  });

  it('serializes simultaneous additions into one public card and returns the same link', async () => {
    const f = fixture();
    const links = await Promise.all([
      f.service.ensureMessage(f.player as never, f.channel as never),
      f.service.ensureMessage(f.player as never, f.channel as never),
    ]);
    expect(links).toEqual(['https://discord.com/channels/guild/channel/message', 'https://discord.com/channels/guild/channel/message']);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.controller.setMessage).toHaveBeenCalledOnce();
    expect(f.player.setPlayingMessageUpdater).toHaveBeenLastCalledWith(expect.any(Function), 'message', {keepAfterFinish: true, retryOnError: true});
  });

  it('keeps the saved history when a deleted card must be replaced', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'deleted'});
    f.channel.messages.fetch.mockRejectedValue({code: 10008});
    await f.service.ensureMessage(f.player as never, f.channel as never);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.state.record.entries).toHaveLength(1);
    expect(f.state.record.messageId).toBe('message');
  });

  it('checks Discord for a deleted card even when the message remains cached', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'deleted'});
    f.channel.messages.fetch.mockImplementation(async (options: {force?: boolean}) => {
      if (options.force) throw {code: 10008};
      return {...f.card, id: 'deleted'};
    });
    await f.service.ensureMessage(f.player as never, f.channel as never);
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({message: 'deleted', force: true});
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.state.record.messageId).toBe('message');
  });

  it('replaces a deleted private-channel card in its original channel, not the request channel', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'deleted'});
    f.channel.messages.fetch.mockRejectedValue({code: 10008});
    const publicChannel = {...f.channel, id: 'public', send: vi.fn()};
    await f.service.ensureMessage(f.player as never, publicChannel as never);
    expect(f.channel.client.channels.fetch).toHaveBeenCalledWith('channel');
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(publicChannel.send).not.toHaveBeenCalled();
    expect(f.state.record.channelId).toBe('channel');
  });

  it.each(['stopped', 'disconnected'] as const)('publishes the captured recap when %s during the initial database flush', async status => {
    const f = fixture();
    f.controller.flush.mockImplementationOnce(async () => {
      f.state.record.endedAt = new Date();
      f.state.record.endReason = status;
      f.state.record.entries[0].status = status;
    });
    await f.service.ensureMessage(f.player as never, f.channel as never);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.channel.send.mock.calls[0][0].embeds[0].data.title).toBe('Session recap');
    expect(f.controller.setMessage).toHaveBeenCalledWith('channel', 'message');
    expect(f.player.setPlayingMessageUpdater).not.toHaveBeenCalled();
    expect(f.state.record.messageId).toBe('message');
  });

  it('pins the captured recap when a different session starts during the initial database flush', async () => {
    const f = fixture();
    f.controller.flush.mockImplementationOnce(async () => {
      f.state.record.endedAt = new Date();
      f.state.record.entries[0].status = 'stopped';
      f.state.record = {...record(), id: 'b4d70da3-1b9f-4e13-a962-2156db953d73'};
    });
    await f.service.ensureMessage(f.player as never, f.channel as never);
    expect(f.channel.send.mock.calls[0][0].embeds[0].data.title).toBe('Session recap');
    expect(f.controller.setMessage).not.toHaveBeenCalled();
    expect(f.player.setPlayingMessageUpdater).not.toHaveBeenCalled();
    expect(f.store.save).toHaveBeenCalledWith(expect.objectContaining({id, channelId: 'channel', messageId: 'message'}));
    expect(f.state.record.channelId).toBeNull();
    expect(f.state.record.messageId).toBeNull();
  });

  it('does not create duplicate cards after an access or network failure', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.channel.messages.fetch.mockRejectedValue({code: 50013});
    await expect(f.service.ensureMessage(f.player as never, f.channel as never)).rejects.toEqual({code: 50013});
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it('leaves publication retryable if Discord rejects the public send', async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error('send failed'));
    await expect(f.service.ensureMessage(f.player as never, f.channel as never)).rejects.toThrow('send failed');
    expect(f.state.record.messageId).toBeNull();
    expect(f.player.setPlayingMessageUpdater).not.toHaveBeenCalled();
    await f.service.ensureMessage(f.player as never, f.channel as never);
    expect(f.state.record.messageId).toBe('message');
  });

  it('keeps the original channel after the first public send fails', async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error('temporary send failure'));
    await expect(f.service.ensureMessage(f.player as never, f.channel as never)).rejects.toThrow('temporary send failure');
    expect(f.state.record.channelId).toBe('channel');
    const publicChannel = {...f.channel, id: 'public', send: vi.fn()};
    await f.service.ensureMessage(f.player as never, publicChannel as never);
    expect(f.channel.send).toHaveBeenCalledTimes(2);
    expect(publicChannel.send).not.toHaveBeenCalled();
    expect(f.state.record.channelId).toBe('channel');
  });

  it('rejects a mismatched publication ID before assigning any origin to the newer session', async () => {
    const f = fixture();
    f.state.record.id = 'b4d70da3-1b9f-4e13-a962-2156db953d73';
    await expect(f.service.ensureMessage(f.player as never, f.channel as never, id)).rejects.toThrow('session has ended');
    expect(f.controller.setChannel).not.toHaveBeenCalled();
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.state.record.channelId).toBeNull();
  });

  it('does not attach a delayed send to a new listening session', async () => {
    const f = fixture();
    f.channel.send.mockImplementation(async () => {
      f.state.record.endedAt = new Date();
      f.state.record = {...record(), id: 'b4d70da3-1b9f-4e13-a962-2156db953d73'};
      return f.card;
    });
    await expect(f.service.ensureMessage(f.player as never, f.channel as never)).resolves.toBe('https://discord.com/channels/guild/channel/message');
    expect(f.controller.setMessage).not.toHaveBeenCalled();
    expect(f.store.save).toHaveBeenCalledWith(expect.objectContaining({id, channelId: 'channel', messageId: 'message'}));
    expect(f.card.edit.mock.calls[0][0].embeds[0].data.title).toBe('Session recap');
  });

  it('freezes a recap when Stop completes while its first card is being sent', async () => {
    const f = fixture();
    f.channel.send.mockImplementation(async () => {
      f.state.record.endedAt = new Date();
      f.state.record.entries[0].status = 'stopped';
      return f.card;
    });
    await f.service.ensureMessage(f.player as never, f.channel as never);
    expect(f.controller.setMessage).toHaveBeenCalledWith('channel', 'message');
    expect(f.player.setPlayingMessageUpdater).not.toHaveBeenCalled();
    expect(f.card.edit.mock.calls[0][0].components).toEqual([]);
    expect(f.card.edit.mock.calls[0][0].embeds[0].data.description).toContain('Stopped');
  });

  it('removes an unbound card when saving its message binding fails', async () => {
    const f = fixture();
    f.controller.setMessage.mockRejectedValue(new Error('write failed'));
    await expect(f.service.ensureMessage(f.player as never, f.channel as never)).rejects.toThrow('write failed');
    expect(f.card.delete).toHaveBeenCalledOnce();
  });

  it('waits for queued terminal persistence before rendering the old session after a new one starts', async () => {
    const f = fixture();
    await f.service.ensureMessage(f.player as never, f.channel as never);
    const old = structuredClone(f.state.record);
    f.records.set(id, old);
    const terminal = {...structuredClone(old), endedAt: new Date(), endReason: 'stopped'};
    terminal.entries[0].status = 'stopped';
    f.state.record = {...record(), id: 'b4d70da3-1b9f-4e13-a962-2156db953d73'};
    let finishWrite!: () => void;
    f.controller.flush.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishWrite = () => { f.records.set(id, terminal); resolve(); };
    }));
    const render = f.state.updater!();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.card.edit).not.toHaveBeenCalled();
    finishWrite();
    await render;
    const payload = f.card.edit.mock.calls[0][0];
    expect(payload.embeds[0].data.description).toContain('Stopped');
    expect(payload.embeds[0].data.description).toContain('Session ended');
    expect(payload.components).toEqual([]);
  });

  it('renders a completed queue as history while retaining the shared card', async () => {
    const f = fixture();
    await f.service.ensureMessage(f.player as never, f.channel as never);
    f.player.getCurrent.mockReturnValue(null as never);
    f.state.record.entries[0].status = 'completed';
    await f.state.updater!();
    const edit = f.card.edit.mock.calls[0][0];
    expect(edit.embeds[0].data.description).toContain('First song');
    expect(edit.embeds[0].data.description).toContain('Played');
    expect(edit.components).toEqual([]);
    expect(f.card.delete).not.toHaveBeenCalled();
  });
});

const receipt = (f: ReturnType<typeof fixture>, messageId = '200') => ({
  ...f.card, id: messageId, guildId: 'guild', content: 'u betcha, **Next song** added to the queue — <@listener>',
  author: {id: 'bot'}, flags: {has: () => false},
  edit: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined),
});

describe('moving the player onto public queue receipts', () => {
  it('binds the first receipt without sending a standalone card and retains its text on updates', async () => {
    const f = fixture();
    const next = receipt(f);
    await f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never));
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.state.record.messageId).toBe(next.id);
    expect(next.edit).toHaveBeenCalledTimes(2);
    expect(f.player.refreshPlayingMessage).not.toHaveBeenCalled();
    expect(f.player.setPlayingMessageUpdater).toHaveBeenLastCalledWith(expect.any(Function), next.id, {keepAfterFinish: true, retryOnError: true});
    await f.state.updater!();
    expect(next.edit.mock.calls.every(([payload]) => payload.content === undefined)).toBe(true);
    expect(next.edit.mock.calls.at(-1)![0].components).toHaveLength(2);
    f.state.record.endedAt = new Date();
    f.state.record.entries[0].status = 'stopped';
    await f.state.updater!();
    expect(next.edit.mock.calls.at(-1)![0]).toMatchObject({content: undefined, components: []});
    expect(next.edit.mock.calls.at(-1)![0].embeds[0].data.title).toBe('Session recap');
  });

  it('leaves the old receipt as text and makes its previously queued updater a no-op', async () => {
    const f = fixture();
    f.card.id = '100';
    f.card.content = 'u betcha, First song added to the queue — <@listener>';
    await f.service.ensureMessage(f.player as never, f.channel as never);
    const oldUpdater = f.state.updater!;
    const next = receipt(f);
    await f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never));
    expect(f.card.edit).toHaveBeenLastCalledWith(expect.objectContaining({embeds: [], components: []}));
    expect(f.card.delete).not.toHaveBeenCalled();
    const calls = f.card.edit.mock.calls.length;
    await oldUpdater();
    expect(f.card.edit).toHaveBeenCalledTimes(calls);
    expect(f.state.record.messageId).toBe('200');
  });

  it('retires an empty legacy standalone card without trying to edit it to an empty message', async () => {
    const f = fixture();
    f.card.id = '100';
    Object.assign(f.state.record, {channelId: 'channel', messageId: '100'});
    const next = receipt(f);
    await f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never));
    expect(f.card.edit).toHaveBeenCalledWith({components: []});
    expect(f.card.delete).toHaveBeenCalledOnce();
    expect(f.controller.setMessage).toHaveBeenCalledBefore(f.card.delete);
  });

  it('reserves publication before the first receipt arrives and lets the newest snowflake win', async () => {
    const f = fixture();
    let resolve!: (message: never) => void;
    const firstReceipt = new Promise<never>(done => { resolve = done; });
    const newest = receipt(f, '300');
    const older = receipt(f, '200');
    const first = f.service.attachToReply(f.player as never, f.channel as never, firstReceipt);
    const second = f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(older as never));
    await new Promise<void>(done => setImmediate(done));
    expect(older.edit).not.toHaveBeenCalled();
    resolve(newest as never);
    await Promise.all([first, second]);
    expect(f.state.record.messageId).toBe('300');
    expect(older.edit).not.toHaveBeenCalled();
  });

  it('keeps a later request in another channel as a receipt without exposing the original player', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'original', messageId: '100'});
    const next = receipt(f);
    await f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never));
    expect(next.edit).not.toHaveBeenCalled();
    expect(f.controller.setMessage).not.toHaveBeenCalled();
    expect(f.state.record.channelId).toBe('original');
  });

  it.each(['author', 'guild', 'channel', 'ephemeral'])('rejects a receipt with invalid %s', async invalid => {
    const f = fixture();
    const next = receipt(f);
    if (invalid === 'author') next.author.id = 'another-bot';
    if (invalid === 'guild') next.guildId = 'another-guild';
    if (invalid === 'channel') next.channelId = 'another-channel';
    if (invalid === 'ephemeral') next.flags.has = () => true;
    await expect(f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never))).rejects.toThrow('public bot receipt');
    expect(next.edit).not.toHaveBeenCalled();
    expect(f.controller.setMessage).not.toHaveBeenCalled();
  });

  it('pins a delayed receipt to the completed session when a new session starts', async () => {
    const f = fixture();
    let resolve!: (message: never) => void;
    const pending = f.service.attachToReply(f.player as never, f.channel as never, new Promise<never>(done => { resolve = done; }));
    f.state.record.endedAt = new Date();
    f.state.record.entries[0].status = 'stopped';
    f.state.record = {...record(), id: 'b4d70da3-1b9f-4e13-a962-2156db953d73'};
    const next = receipt(f);
    resolve(next as never);
    await pending;
    expect(f.controller.setMessage).not.toHaveBeenCalled();
    expect(f.state.record.messageId).toBeNull();
    expect(f.player.setPlayingMessageUpdater).not.toHaveBeenCalled();
    expect(f.records.get(id)?.messageId).toBe('200');
    expect(next.edit.mock.calls.at(-1)![0].components).toEqual([]);
    expect(next.edit.mock.calls.at(-1)![0].embeds[0].data.title).toBe('Session recap');
  });

  it('renders a recap if Stop arrives while the new player edit is in flight', async () => {
    const f = fixture();
    const next = receipt(f);
    next.edit.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      f.state.record.endedAt = new Date();
      f.state.record.entries[0].status = 'stopped';
    });
    await f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never));
    await f.state.updater!();
    expect(next.edit.mock.calls.at(-1)![0].components).toEqual([]);
    expect(next.edit.mock.calls.at(-1)![0].embeds[0].data.title).toBe('Session recap');
  });

  it('keeps the old binding when retiring the old card fails', async () => {
    const f = fixture();
    f.card.id = '100';
    f.card.content = 'Previous request';
    Object.assign(f.state.record, {channelId: 'channel', messageId: '100'});
    f.card.edit.mockRejectedValueOnce(new Error('Discord unavailable'));
    const next = receipt(f);
    await expect(f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never))).rejects.toThrow('Discord unavailable');
    expect(f.state.record.messageId).toBe('100');
    expect(f.card.delete).not.toHaveBeenCalled();
    expect(next.edit).toHaveBeenLastCalledWith(expect.objectContaining({embeds: [], components: []}));
  });

  it('restores a mutated binding when persistence fails and preserves both receipt texts', async () => {
    const f = fixture();
    f.card.id = '100';
    f.card.content = 'Previous request';
    Object.assign(f.state.record, {channelId: 'channel', messageId: '100'});
    f.controller.setMessage.mockImplementationOnce(async (_channelId, messageId) => {
      f.state.record.messageId = messageId;
      throw new Error('SQLite unavailable');
    });
    const next = receipt(f);
    await expect(f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never))).rejects.toThrow('SQLite unavailable');
    expect(f.state.record.messageId).toBe('100');
    expect(f.card.edit.mock.calls.at(-1)![0].components).toHaveLength(2);
    expect(next.edit).toHaveBeenLastCalledWith(expect.objectContaining({embeds: [], components: []}));
    expect(f.card.delete).not.toHaveBeenCalled();
    expect(next.delete).not.toHaveBeenCalled();
  });

  it('restores the old updater if enabling the new card fails after binding', async () => {
    const f = fixture();
    f.card.id = '100';
    f.card.content = 'Previous request';
    await f.service.ensureMessage(f.player as never, f.channel as never);
    const next = receipt(f);
    next.edit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Discord unavailable'));
    await expect(f.service.attachToReply(f.player as never, f.channel as never, Promise.resolve(next as never))).rejects.toThrow('Discord unavailable');
    expect(f.state.record.messageId).toBe('100');
    expect(f.player.setPlayingMessageUpdater).toHaveBeenLastCalledWith(expect.any(Function), '100', {keepAfterFinish: true, retryOnError: true});
    const previousCalls = f.card.edit.mock.calls.length;
    await f.state.updater!();
    expect(f.card.edit).toHaveBeenCalledTimes(previousCalls + 1);
    expect(f.card.delete).not.toHaveBeenCalled();
  });

  it('preserves the receipt text when recovery replaces its player with a recap', async () => {
    const f = fixture();
    f.card.content = 'u betcha, First song added to the queue — <@listener>';
    const old = {...record(), channelId: 'channel', messageId: f.card.id, endedAt: new Date(), endReason: 'interrupted'};
    old.entries[0].status = 'interrupted';
    f.store.interruptOpenSessions.mockResolvedValue([old]);
    await f.service.prepareRecovery();
    await f.service.recover(f.channel.client as never);
    expect(f.card.edit).toHaveBeenCalledWith(expect.objectContaining({content: undefined, components: []}));
    expect(f.card.edit.mock.calls.at(-1)![0].embeds[0].data.title).toBe('Session recap');
    expect(f.store.markRecovered).toHaveBeenCalledWith(id);
  });

  it('rejects transport clicks from a retired public receipt', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: '200'});
    const click = f.interaction('next');
    click.message = {id: '100', flags: {has: () => false}};
    await f.service.handleButton(click as never);
    expect(f.player.forward).not.toHaveBeenCalled();
    expect(click.editReply).toHaveBeenCalledWith(expect.stringContaining('player moved'));
  });

  it('rechecks the bound card after slow control authorization', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: '100'});
    permission.mockImplementationOnce(async () => { f.state.record.messageId = '200'; return true; });
    const click = f.interaction('next');
    await f.service.handleButton(click as never);
    expect(f.player.forward).not.toHaveBeenCalled();
  });
});

describe('session buttons and durable history', () => {
  it.each([STATUS.PLAYING, STATUS.PAUSED])('shows the same private queue as /queue while %s', async status => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.member.voice.channelId = 'other-voice';
    f.player.status = status;
    f.player.getCurrent.mockReturnValue({...track(), thumbnailUrl: 'https://example.test/art.jpg'} as never);
    f.player.getQueue.mockReturnValue(Array.from({length: 12}, (_, index) => track(`Upcoming ${index + 1}`)));
    f.player.queueSize.mockReturnValue(12);
    const interaction = f.interaction('queue');

    await f.service.handleButton(interaction as never);

    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.embeds[0].toJSON()).toEqual(buildQueueEmbed(f.player as never, 1, 10).toJSON());
    expect(payload.embeds[0].data.description).toContain('Upcoming 10');
    expect(payload.embeds[0].data.description).not.toContain('Upcoming 11');
    expect(payload.components[0].components.map(button => [button.label, button.disabled])).toEqual([
      ['Previous page', true], ['Next page', false],
    ]);
    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: true});
    expect(permission).not.toHaveBeenCalled();
    expect(guildSettings).toHaveBeenCalledWith('guild');
  });

  it('uses the configured queue page size for private pagination', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    guildSettings.mockResolvedValue({defaultQueuePageSize: 2});
    f.player.getQueue.mockReturnValue([track('Second song'), track('Third song'), track('Fourth song')]);
    f.player.queueSize.mockReturnValue(3);
    const interaction = f.interaction('queue', 1);

    await f.service.handleButton(interaction as never);

    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.embeds[0].toJSON()).toEqual(buildQueueEmbed(f.player as never, 2, 2).toJSON());
    expect(payload.embeds[0].data.description).toContain('`3.`');
    expect(payload.embeds[0].data.description).toContain('Fourth song');
    expect(payload.embeds[0].data.description).not.toContain('Second song');
    expect(payload.components[0].components.map(button => [button.custom_id, button.disabled])).toEqual([
      [sessionButtonId(id, 'queue', 0), false], [sessionButtonId(id, 'queue', 2), true],
    ]);
  });

  it('clamps an old queue page when tracks finish during the settings lookup', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.player.getQueue.mockReturnValue(Array.from({length: 8}, (_, index) => track(`Upcoming ${index + 1}`)));
    f.player.queueSize.mockReturnValue(8);
    guildSettings.mockImplementationOnce(async () => {
      f.player.getQueue.mockReturnValue([track('Last queued song')]);
      f.player.queueSize.mockReturnValue(1);
      return {defaultQueuePageSize: 2};
    });
    const interaction = f.interaction('queue', 3);

    await f.service.handleButton(interaction as never);

    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.embeds[0].toJSON()).toEqual(buildQueueEmbed(f.player as never, 1, 2).toJSON());
    expect(payload.embeds[0].data.description).toContain('Last queued song');
    expect(payload.components).toEqual([]);
  });

  it.each([false, true])('handles the queue finishing during a settings lookup (session ended: %s)', async ended => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    guildSettings.mockImplementationOnce(async () => {
      f.player.getCurrent.mockReturnValue(null as never);
      f.player.getQueue.mockReturnValue([]);
      f.player.queueSize.mockReturnValue(0);
      if (ended) f.state.record.endedAt = new Date();
      return {defaultQueuePageSize: 10};
    });
    const interaction = f.interaction('queue');

    await f.service.handleButton(interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(ended
      ? 'This listening session has ended. Its history is still available.' : 'The queue is empty.');
  });

  it('acknowledges privately before checking history and allows reads outside voice', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.member.voice.channelId = 'other-voice';
    const interaction = f.interaction('history');
    await f.service.handleButton(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: true});
    expect(interaction.deferReply).toHaveBeenCalledBefore(f.store.load);
    expect(interaction.editReply.mock.calls[0][0].embeds[0].data.title).toBe('Session history');
    expect(permission).not.toHaveBeenCalled();
  });

  it('keeps history working without an in-memory player after restart', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message', endedAt: new Date(), endReason: 'interrupted'});
    f.manager.getExisting.mockReturnValue(undefined as never);
    const history = f.interaction('history');
    await f.service.handleButton(history as never);
    expect(history.editReply.mock.calls[0][0].embeds[0].data.description).toContain('First song');
    const staleControl = f.interaction('next');
    await f.service.handleButton(staleControl as never);
    expect(staleControl.editReply).toHaveBeenCalledWith(expect.stringContaining('session has ended'));
    expect(f.player.forward).not.toHaveBeenCalled();
  });

  it('does not expose saved history after original-channel access is revoked', async () => {
    const f = fixture();
    f.state.record.channelId = 'channel';
    f.channel.permissionsFor.mockReturnValue({has: () => false});
    const interaction = f.interaction('history');
    await f.service.handleButton(interaction as never);
    expect(interaction.editReply).toHaveBeenCalledWith('This listening session is not available in this channel.');
  });

  it('requires the original channel even for a forged session control', async () => {
    const f = fixture();
    f.state.record.channelId = 'private-channel';
    const interaction = f.interaction('history');
    await f.service.handleButton(interaction as never);
    expect(interaction.editReply).toHaveBeenCalledWith('This listening session is not available in this channel.');
  });

  it('checks the matching slash permission against the public card and keeps denials private', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    permission.mockResolvedValue(false);
    const interaction = f.interaction('next');
    await f.service.handleButton(interaction as never);
    expect(permission).toHaveBeenCalledWith(f.card, 'listener', 'next');
    expect(f.player.forward).not.toHaveBeenCalled();
    expect(f.card.edit).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('permission'));
  });

  it('replaces a cached deleted card before accepting controls', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.channel.messages.fetch.mockImplementation(async (options: {force?: boolean}) => {
      if (options.force) throw {code: 10008};
      return f.card;
    });
    f.channel.send.mockResolvedValue({...f.card, id: 'replacement'});
    const interaction = f.interaction('next');
    await f.service.handleButton(interaction as never);
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({message: 'message', force: true});
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.player.forward).not.toHaveBeenCalled();
    expect(f.state.record.messageId).toBe('replacement');
    expect(interaction.editReply).toHaveBeenCalledWith('The player card was replaced. Use its new controls.');
  });

  it.each([
    {label: 'removed cached membership', response: new Error('Unknown Member')},
    {label: 'an unrelated member collection', response: new Collection([['another-user', {id: 'another-user'}]])},
    {label: 'a different individual member', response: {user_id: 'another-user'}},
  ])('denies private-thread history for $label', async ({response}) => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    const cachedFetch = vi.fn().mockResolvedValue({id: 'listener'});
    Object.assign(f.channel, {type: ChannelType.PrivateThread, isThread: () => true, parentId: 'parent', members: {fetch: cachedFetch}});
    f.channel.permissionsFor.mockReturnValue({has: (permissions: unknown) => Array.isArray(permissions)});
    if (response instanceof Error) f.channel.client.rest.get.mockRejectedValue(response);
    else f.channel.client.rest.get.mockResolvedValue(response);
    const interaction = f.interaction('history');
    await f.service.handleButton(interaction as never);
    expect(f.channel.client.rest.get).toHaveBeenCalledWith('/channels/channel/thread-members/listener');
    expect(cachedFetch).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith('This listening session is not available in this channel.');
  });

  it('allows private-thread history only when a fresh individual lookup confirms the requesting user', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    Object.assign(f.channel, {type: ChannelType.PrivateThread, isThread: () => true, parentId: 'parent'});
    f.channel.permissionsFor.mockReturnValue({has: (permissions: unknown) => Array.isArray(permissions)});
    f.channel.client.rest.get.mockResolvedValue({user_id: 'listener'});
    const interaction = f.interaction('history');
    await f.service.handleButton(interaction as never);
    expect(f.channel.client.rest.get).toHaveBeenCalledWith('/channels/channel/thread-members/listener');
    expect(interaction.editReply.mock.calls[0][0].embeds[0].data.title).toBe('Session history');
  });

  it('preserves pause state when seeking and clamps the target to the track', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.player.status = STATUS.PAUSED;
    f.player.getPosition = () => 175;
    await f.service.handleButton(f.interaction('forward') as never);
    expect(permission).toHaveBeenCalledWith(f.card, 'listener', 'fseek');
    expect(f.player.seek).toHaveBeenCalledWith(180, {preservePausedState: true});
  });

  it.each(['previous', 'backward', 'pause', 'resume', 'forward', 'next', 'shuffle', 'stop'])('dismisses the private acknowledgement after successful %s without a status reply', async action => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.player.canGoBack = () => true;
    const interaction = f.interaction(action);
    await f.service.handleButton(interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: true});
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(f.player.refreshPlayingMessage).toHaveBeenCalledOnce();
  });

  it('leaves the private acknowledgement available for the error handler when an action fails', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.player.pause.mockImplementation(() => { throw new Error('Playback failed'); });
    const interaction = f.interaction('pause');
    await expect(f.service.handleButton(interaction as never)).rejects.toThrow('Playback failed');
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(f.card.edit).not.toHaveBeenCalled();
  });

  it('waits for saved history before dismissing the Stop acknowledgement', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    let release!: () => void;
    f.player.stop.mockImplementation(() => {
      f.controller.flush.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    });
    const interaction = f.interaction('stop');
    const action = f.service.handleButton(interaction as never);
    await vi.waitFor(() => expect(f.player.stop).toHaveBeenCalledOnce());
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    release();
    await action;
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('rejects old session controls after a different session starts', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message', endedAt: new Date()});
    f.state.record = {...record(), id: 'b4d70da3-1b9f-4e13-a962-2156db953d73'};
    const interaction = f.interaction('next');
    await f.service.handleButton(interaction as never);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('session has ended'));
    expect(f.player.forward).not.toHaveBeenCalled();
  });

  it('keeps click arrival order across slow authorization and acknowledges waiting clicks immediately', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.player.canGoBack = () => true;
    const actions: string[] = [];
    f.player.forward.mockImplementation(() => { actions.push('next'); });
    f.player.back.mockImplementation(() => { actions.push('previous'); });
    let authorize!: (member: typeof f.member) => void;
    f.guild.members.fetch.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
    const firstClick = f.interaction('next');
    const secondClick = f.interaction('previous');
    const first = f.service.handleButton(firstClick as never);
    await vi.waitFor(() => expect(f.guild.members.fetch).toHaveBeenCalledOnce());
    const second = f.service.handleButton(secondClick as never);
    expect(secondClick.deferReply).toHaveBeenCalledWith({ephemeral: true});
    await new Promise<void>(resolve => setImmediate(resolve));
    authorize(f.member);
    await Promise.all([first, second]);
    expect(actions).toEqual(['next', 'previous']);
  });

  it('reserves click order even when the first acknowledgement is slow', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    f.player.canGoBack = () => true;
    const actions: string[] = [];
    f.player.forward.mockImplementation(() => { actions.push('next'); });
    f.player.back.mockImplementation(() => { actions.push('previous'); });
    let acknowledge!: () => void;
    const firstClick = f.interaction('next');
    firstClick.deferReply.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const first = f.service.handleButton(firstClick as never);
    const secondClick = f.interaction('previous');
    const second = f.service.handleButton(secondClick as never);
    expect(secondClick.deferReply).toHaveBeenCalledWith({ephemeral: true});
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(actions).toEqual([]);
    acknowledge();
    await Promise.all([first, second]);
    expect(actions).toEqual(['next', 'previous']);
  });

  it('does not publish a new session when an old control discovers its deleted card late', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    let rejectFetch!: (error: unknown) => void;
    f.channel.messages.fetch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));
    const interaction = f.interaction('next');
    const action = f.service.handleButton(interaction as never);
    await vi.waitFor(() => expect(f.channel.messages.fetch).toHaveBeenCalledOnce());
    f.state.record.endedAt = new Date();
    f.state.record = {...record(), id: 'b4d70da3-1b9f-4e13-a962-2156db953d73'};
    rejectFetch({code: 10008});
    await action;
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.player.forward).not.toHaveBeenCalled();
    expect(f.state.record.channelId).toBeNull();
    expect(interaction.editReply).toHaveBeenCalledWith('This listening session has ended.');
  });

  it('serializes controls and rechecks the session after a slow permission lookup', async () => {
    const f = fixture();
    Object.assign(f.state.record, {channelId: 'channel', messageId: 'message'});
    let release!: (value: boolean) => void;
    permission.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = f.service.handleButton(f.interaction('next') as never);
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce());
    const second = f.service.handleButton(f.interaction('next') as never);
    f.state.record.endedAt = new Date();
    release(true);
    await Promise.all([first, second]);
    expect(f.player.forward).not.toHaveBeenCalled();
    expect(permission).toHaveBeenCalledOnce();
  });

  it.each([
    {label: 'unpublished', messageId: null, trackCount: 1},
    {label: 'deleted', messageId: 'deleted', trackCount: 1},
    {label: 'unpublished buffering', messageId: null, trackCount: 0},
  ])('recovers an $label session card in its saved channel and persists the history binding', async ({messageId, trackCount}) => {
    const f = fixture();
    const old = {...record(), channelId: 'channel', messageId, endedAt: new Date(), endReason: 'interrupted'};
    old.entries = old.entries.slice(0, trackCount).map(entry => ({...entry, status: 'interrupted'}));
    f.store.interruptOpenSessions.mockResolvedValue([old]);
    if (messageId) f.channel.messages.fetch.mockRejectedValue({code: 10008});
    await f.service.prepareRecovery();
    await f.service.recover(f.channel.client as never);
    expect(f.channel.client.channels.fetch).toHaveBeenCalledWith('channel');
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.channel.send.mock.calls[0][0].embeds[0].data.title).toBe('Session recap');
    expect(f.store.save).toHaveBeenCalledWith(expect.objectContaining({id, channelId: 'channel', messageId: 'message', endedAt: old.endedAt}));
    expect(f.records.get(id)!.entries).toHaveLength(trackCount);
    expect(f.store.markRecovered).toHaveBeenCalledWith(id);
    expect(f.store.markRecovered).toHaveBeenCalledAfter(f.store.save);
    f.manager.getExisting.mockReturnValue(undefined as never);
    const history = f.interaction('history');
    await f.service.handleButton(history as never);
    expect(history.editReply.mock.calls[0][0].embeds[0].data.title).toBe('Session history');
  });

  it('does not replace a recovery card when its original channel denies access', async () => {
    const f = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const old = {...record(), channelId: 'channel', messageId: 'message', endedAt: new Date(), endReason: 'interrupted'};
    f.store.interruptOpenSessions.mockResolvedValue([old]);
    f.channel.messages.fetch.mockRejectedValue({code: 50013});
    try {
      await f.service.prepareRecovery();
      await f.service.recover(f.channel.client as never);
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(f.store.save).not.toHaveBeenCalled();
      expect(f.store.markRecovered).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(`Could not refresh archived listening-session card ${id}.`);
    } finally {
      log.mockRestore();
    }
  });

  it('removes an unbound recovery card if its replacement binding cannot be saved', async () => {
    const f = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const old = {...record(), channelId: 'channel', endedAt: new Date(), endReason: 'interrupted'};
    f.store.interruptOpenSessions.mockResolvedValue([old]);
    f.store.save.mockRejectedValue(new Error('database unavailable'));
    try {
      await f.service.prepareRecovery();
      await f.service.recover(f.channel.client as never);
      expect(f.channel.send).toHaveBeenCalledOnce();
      expect(f.card.delete).toHaveBeenCalledOnce();
      expect(f.store.markRecovered).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(`Could not refresh archived listening-session card ${id}.`);
    } finally {
      log.mockRestore();
    }
  });

  it('retries pending recap publication after a failed startup without re-interrupting its saved history', async () => {
    const f = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const interruptedAt = new Date('2026-10-24T12:05:00Z');
    const old = {...record(), channelId: 'channel', endedAt: interruptedAt, endReason: 'interrupted'};
    old.entries[0].status = 'interrupted';
    f.records.set(id, old);
    let pending = true;
    f.store.interruptOpenSessions.mockImplementation(async () => pending ? [structuredClone(f.records.get(id)!)] : []);
    f.store.markRecovered.mockImplementation(async () => { pending = false; });
    f.channel.send.mockRejectedValueOnce(new Error('Discord unavailable'));
    try {
      await f.service.prepareRecovery();
      await f.service.recover(f.channel.client as never);
      expect(pending).toBe(true);
      expect(f.store.markRecovered).not.toHaveBeenCalled();
      const restarted = new SessionPlayer(f.manager as never, f.store as never);
      await restarted.prepareRecovery();
      await restarted.recover(f.channel.client as never);
      expect(f.channel.send).toHaveBeenCalledTimes(2);
      expect(f.records.get(id)).toMatchObject({messageId: 'message', endedAt: interruptedAt, endReason: 'interrupted'});
      expect(f.store.markRecovered).toHaveBeenCalledWith(id);
      expect(pending).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it('recovers pending history on a second startup if the first startup stopped before Discord login', async () => {
    const f = fixture();
    const old = {...record(), channelId: 'channel', endedAt: new Date(), endReason: 'interrupted'};
    f.store.interruptOpenSessions.mockResolvedValue([old]);
    await f.service.prepareRecovery();
    expect(f.channel.send).not.toHaveBeenCalled();
    const restarted = new SessionPlayer(f.manager as never, f.store as never);
    await restarted.prepareRecovery();
    await restarted.recover(f.channel.client as never);
    expect(f.store.interruptOpenSessions).toHaveBeenCalledTimes(2);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.store.markRecovered).toHaveBeenCalledWith(id);
  });

  it('retains a valid bound recovery card when clearing its pending flag fails and reuses it on the next startup', async () => {
    const f = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const old = {...record(), channelId: 'channel', endedAt: new Date(), endReason: 'interrupted'};
    f.records.set(id, old);
    let pending = true;
    f.store.interruptOpenSessions.mockImplementation(async () => pending ? [structuredClone(f.records.get(id)!)] : []);
    f.store.markRecovered.mockRejectedValueOnce(new Error('database busy')).mockImplementation(async () => { pending = false; });
    try {
      await f.service.prepareRecovery();
      await f.service.recover(f.channel.client as never);
      expect(f.records.get(id)!.messageId).toBe('message');
      expect(f.card.delete).not.toHaveBeenCalled();
      expect(pending).toBe(true);
      const restarted = new SessionPlayer(f.manager as never, f.store as never);
      await restarted.prepareRecovery();
      await restarted.recover(f.channel.client as never);
      expect(f.channel.send).toHaveBeenCalledOnce();
      expect(f.card.edit).toHaveBeenCalledTimes(2);
      expect(f.store.markRecovered).toHaveBeenCalledTimes(2);
      expect(f.store.markRecovered).toHaveBeenLastCalledWith(id);
      expect(f.card.delete).not.toHaveBeenCalled();
      expect(pending).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it('marks old sessions interrupted before login and edits only saved old cards later', async () => {
    const f = fixture();
    const old = {...record(), channelId: 'channel', messageId: 'message', endedAt: new Date(), endReason: 'interrupted'};
    old.entries[0].status = 'interrupted';
    f.store.interruptOpenSessions.mockResolvedValue([old]);
    await f.service.prepareRecovery();
    expect(f.card.edit).not.toHaveBeenCalled();
    await f.service.recover(f.channel.client as never);
    expect(f.store.interruptOpenSessions).toHaveBeenCalledOnce();
    expect(f.card.edit.mock.calls[0][0].components).toEqual([]);
    expect(f.card.edit.mock.calls[0][0].embeds[0].data.description).toContain('Interrupted');
    expect(f.store.markRecovered).toHaveBeenCalledAfter(f.card.edit);
  });
});

describe('bounded session rendering', () => {
  it('keeps hostile long titles and URLs within Discord limits without changing sources', () => {
    const f = fixture();
    const long = {...track('*[]()'.repeat(400)), url: 'https://example.test/' + 'é'.repeat(500), source: MediaSource.HLS};
    f.player.getCurrent.mockReturnValue(long);
    f.player.getQueue.mockReturnValue(Array.from({length: 20}, () => long));
    f.state.record.entries = Array.from({length: 50}, (_, index) => ({...f.state.record.entries[0], ...long, source: 'HLS', id: String(index)}));
    for (const payload of [buildSessionMessage(f.state.record, f.player as never), ...buildHistoryMessages(f.state.record), buildQueueMessage(f.state.record, f.player as never)]) {
      const embed = payload.embeds[0].toJSON();
      expect(embed.description!.length).toBeLessThanOrEqual(4096);
      expect(JSON.stringify(embed).length).toBeLessThan(6000);
      // Recaps use shorter history links; the classic live card retains its
      // existing link format while enforcing the same Discord message limits.
      if (!embed.title?.startsWith('Now Playing')) expect(embed.description).not.toContain(long.url);
      expect(payload.allowedMentions).toEqual({parse: []});
      for (const button of payload.components.flatMap(row => row.components)) expect(button.custom_id.length).toBeLessThanOrEqual(100);
    }
    expect(long.url.length).toBeGreaterThan(500);
  });

  it('shows every track directly in a short recap without history controls', () => {
    const session = record();
    session.endedAt = new Date();
    session.entries = Array.from({length: 12}, (_, index) => ({...session.entries[0], title: `Track ${index + 1}`, status: index === 3 ? 'skipped' : 'completed'}));
    const recaps = buildSessionMessages(session);
    expect(recaps).toHaveLength(1);
    const text = recaps[0].embeds.map(embed => embed.data.description).join('\n');
    for (let n = 1; n <= 12; n++) expect(text).toContain(`${n}. [Track ${n}]`);
    expect(text).toContain('Skipped');
    expect(recaps[0].components).toEqual([]);
  });

  it('uses labeled controls and disables seek for live streams', () => {
    const f = fixture();
    f.player.status = STATUS.PAUSED;
    f.player.getCurrent.mockReturnValue({...track(), isLive: true});
    expect(buildSessionMessage(f.state.record, f.player as never).components[0].components[2].label).toBe('Resume');
    const controls = buildMoreMessage(f.state.record, f.player as never).components[0].components;
    expect(controls.map(button => button.label)).toEqual(['Back 10 seconds', 'Forward 10 seconds', 'Shuffle']);
    expect(controls.slice(0, 2).every(button => button.disabled)).toBe(true);
    expect(controls.every(button => !('emoji' in button))).toBe(true);
  });
});
