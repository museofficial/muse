import {describe, expect, it, vi} from 'vitest';
import {Collection, EmbedBuilder, MessagePayload, TextChannel} from 'discord.js';
import SessionHistoryPublisher from '../src/services/session-history-publisher.js';
import type {ListeningSessionRecord} from '../src/services/listening-session.js';

const session = (id = 'session'): ListeningSessionRecord => ({
  id, guildId: 'guild', voiceChannelId: 'voice', channelId: 'channel', messageId: '100',
  startedAt: new Date('2026-10-24T12:00:00Z'), endedAt: null, endReason: null, entries: [],
});
const payload = (text: string) => ({
  content: '', embeds: [new EmbedBuilder().setTitle('Session history').setDescription(text)],
  components: [], allowedMentions: {parse: [] as never[]},
});
const markedPayload = (text: string, position = 1) => {
  const value = payload(text);
  value.embeds[0].setURL(`https://discord.com/channels/guild/channel/100#muse-history=session:${position}`);
  return value;
};
type Payload = ReturnType<typeof payload>;
type Body = {content: string; embeds: Array<Record<string, unknown>>; components: unknown[]};
const body = (value: Payload): Body => JSON.parse(JSON.stringify(value)) as Body;

const fixture = (firstSnowflake = 101n) => {
  const events: string[] = [];
  const bindings = new Map<string, Map<number, string>>();
  const intents = new Map<string, Map<number, string>>();
  const nonces = new Map<string, Map<number, string>>();
  let snowflake = firstSnowflake;
  const makeMessage = (id: string, value: Payload) => {
    const message = {
      id, author: {id: 'bot'}, ...body(value),
      edit: vi.fn(async (updated: Payload) => {
        events.push(`edit:${id}`);
        Object.assign(message, body(updated));
        return message;
      }),
      delete: vi.fn(async () => {
        events.push(`delete:${id}`);
        messages.delete(id);
      }),
    };
    return message;
  };
  const messages = new Map<string, ReturnType<typeof makeMessage>>();
  const store = {
    loadHistoryMessages: vi.fn(async (id: string) => [
      ...[...(bindings.get(id) ?? [])].map(([position, messageId]) => ({position, messageId, afterMessageId: null, nonce: null})),
      ...[...(intents.get(id) ?? [])].map(([position, afterMessageId]) => ({position, messageId: null, afterMessageId, nonce: nonces.get(id)?.get(position) ?? '111111111111111111111111'})),
    ]),
    beginHistoryMessage: vi.fn(async (id: string, position: number, afterMessageId: string, nonce: string) => {
      events.push(`begin:${id}:${position}:${afterMessageId}`);
      const rows = intents.get(id) ?? new Map();
      rows.set(position, afterMessageId);
      intents.set(id, rows);
      const savedNonces = nonces.get(id) ?? new Map();
      savedNonces.set(position, nonce);
      nonces.set(id, savedNonces);
      bindings.get(id)?.delete(position);
    }),
    saveHistoryMessage: vi.fn(async (id: string, position: number, messageId: string) => {
      events.push(`bind:${id}:${position}:${messageId}`);
      const rows = bindings.get(id) ?? new Map();
      rows.set(position, messageId);
      bindings.set(id, rows);
      intents.get(id)?.delete(position);
      nonces.get(id)?.delete(position);
    }),
    deleteHistoryMessage: vi.fn(async (id: string, position: number) => {
      events.push(`unbind:${id}:${position}`);
      bindings.get(id)?.delete(position);
      intents.get(id)?.delete(position);
      nonces.get(id)?.delete(position);
    }),
  };
  const channel = {
    id: 'channel', primaryId: '100', client: {user: {id: 'bot'}},
    messages: {fetch: vi.fn(async (options: {message: string; force: boolean} | {limit: number; cache: boolean; before?: string}) => {
      if ('message' in options) {
        events.push(`fetch:${options.message}`);
        const message = messages.get(options.message);
        if (!message) throw {code: 10008};
        return message;
      }

      const rows = [makeMessage(channel.primaryId, payload('primary')), ...messages.values()]
        .filter(message => /^\d+$/.test(message.id) && (!options.before || BigInt(message.id) < BigInt(options.before)))
        .sort((left, right) => BigInt(left.id) > BigInt(right.id) ? -1 : 1).slice(0, options.limit);
      return new Collection(rows.map(message => [message.id, message]));
    })},
    send: vi.fn(async (input: Payload | MessagePayload) => {
      const value = input instanceof MessagePayload ? input.options as Payload : input;
      const id = String(snowflake++);
      events.push(`send:${id}`);
      const message = makeMessage(id, value);
      messages.set(id, message);
      return message;
    }),
  };
  const seed = (position: number, id: string, value = payload('old'), record = session()) => {
    const rows = bindings.get(record.id) ?? new Map();
    rows.set(position, id);
    bindings.set(record.id, rows);
    const message = makeMessage(id, value);
    messages.set(id, message);
    return message;
  };
  const publisher = new SessionHistoryPublisher(store);
  const publish = (values: Payload[], options?: {force?: boolean}, record = session()) => {
    channel.primaryId = record.messageId ?? '100';
    return publisher.publish(channel as never, record, values, options);
  };
  return {events, bindings, intents, messages, store, channel, seed, publisher, publish, nextSnowflake: (id: bigint) => { snowflake = id; }};
};

describe('durable public session history', () => {
  it('sends and durably binds each continuation before sending the next', async () => {
    const f = fixture();
    await f.publish([payload('1–5'), payload('6–10')]);
    expect(f.events).toEqual(['begin:session:1:100', 'send:101', 'bind:session:1:101', 'begin:session:2:101', 'send:102', 'bind:session:2:102']);
    expect([...f.bindings.get('session')!]).toEqual([[1, '101'], [2, '102']]);
  });

  it('reuses the persisted first page after a partial send failure and process restart', async () => {
    const f = fixture();
    const send = f.channel.send.getMockImplementation()!;
    f.channel.send.mockImplementationOnce(send).mockRejectedValueOnce(new Error('network'));
    const pages = [payload('first'), payload('second')];
    await expect(f.publish(pages)).rejects.toThrow('network');
    const first = f.messages.get('101')!;
    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, session(), pages);
    expect(f.channel.send).toHaveBeenCalledTimes(3);
    expect(first.edit).not.toHaveBeenCalled();
    expect(f.messages.size).toBe(2);
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({message: '101', force: true});
  });

  it.each([50013, 'ECONNRESET'])('does not duplicate a bound message on fetch error %s', async code => {
    const f = fixture();
    f.seed(1, 'existing');
    f.channel.messages.fetch.mockRejectedValueOnce({code});
    await expect(f.publish([payload('updated')])).rejects.toEqual({code});
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.store.saveHistoryMessage).not.toHaveBeenCalled();
  });

  it('does not duplicate a bound message when editing fails for access reasons', async () => {
    const f = fixture();
    f.seed(1, 'existing').edit.mockRejectedValueOnce({code: 50013});
    await expect(f.publish([payload('updated')])).rejects.toEqual({code: 50013});
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.bindings.get('session')?.get(1)).toBe('existing');
  });

  it('replaces a missing continuation and updates its existing binding', async () => {
    const f = fixture();
    f.seed(1, 'deleted');
    f.messages.delete('deleted');
    await f.publish([payload('saved history')]);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
  });

  it('replaces a continuation deleted between fetching and editing', async () => {
    const f = fixture();
    f.seed(1, 'deleted').edit.mockRejectedValueOnce({code: 10008});
    await f.publish([payload('updated')]);
    expect(f.bindings.get('session')?.get(1)).toBe('101');
  });

  it('retains an accepted send if binding fails and binds it on the next call without resending', async () => {
    const f = fixture();
    f.store.saveHistoryMessage.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.publish([payload('first')])).rejects.toThrow('database unavailable');
    expect(f.events).toEqual(['begin:session:1:100', 'send:101']);
    expect(f.messages.size).toBe(1);
    const accepted = f.messages.get('101')!;
    expect(accepted.delete).not.toHaveBeenCalled();
    expect(f.intents.get('session')?.get(1)).toBe('100');
    await f.publish([payload('first')]);
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.intents.get('session')?.size).toBe(0);
  });

  it('reuses an unbound send across restart after binding persistence fails', async () => {
    const f = fixture();
    f.store.saveHistoryMessage.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.publish([payload('first')])).rejects.toThrow('database unavailable');
    const accepted = f.messages.get('101')!;
    expect(accepted.delete).not.toHaveBeenCalled();
    expect(f.intents.get('session')?.get(1)).toBe('100');
    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, session(), [payload('first')]);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    expect(f.messages.get('101')).toBe(accepted);
  });

  it('publishes desired pages before removing obsolete pages after repacking', async () => {
    const f = fixture();
    f.seed(1, 'first');
    f.seed(2, 'second');
    f.seed(3, 'third');
    await f.publish([payload('all history')]);
    expect(f.events).toEqual(['fetch:first', 'edit:first', 'fetch:second', 'delete:second', 'unbind:session:2', 'fetch:third', 'delete:third', 'unbind:session:3']);
    expect([...f.bindings.get('session')!]).toEqual([[1, 'first']]);
  });

  it('keeps obsolete pages if a desired edit has not succeeded', async () => {
    const f = fixture();
    f.seed(1, 'first').edit.mockRejectedValueOnce(new Error('network'));
    const obsolete = f.seed(2, 'second');
    await expect(f.publish([payload('updated')])).rejects.toThrow('network');
    expect(obsolete.delete).not.toHaveBeenCalled();
    expect(f.store.deleteHistoryMessage).not.toHaveBeenCalled();
  });

  it('retains a binding after obsolete-message deletion is denied and succeeds on retry', async () => {
    const f = fixture();
    const obsolete = f.seed(1, 'obsolete');
    obsolete.delete.mockRejectedValueOnce({code: 50013});
    await expect(f.publish([])).rejects.toEqual({code: 50013});
    expect(f.bindings.get('session')?.get(1)).toBe('obsolete');
    expect(f.store.deleteHistoryMessage).not.toHaveBeenCalled();
    await f.publish([]);
    expect(f.bindings.get('session')?.size).toBe(0);
  });

  it('removes an obsolete binding when its message is already missing', async () => {
    const f = fixture();
    f.seed(1, 'missing');
    f.messages.delete('missing');
    await f.publish([]);
    expect(f.store.deleteHistoryMessage).toHaveBeenCalledWith('session', 1);
  });

  it('retries binding deletion after a message was successfully removed', async () => {
    const f = fixture();
    f.seed(1, 'obsolete');
    f.store.deleteHistoryMessage.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.publish([])).rejects.toThrow('database unavailable');
    await f.publish([]);
    expect(f.bindings.get('session')?.size).toBe(0);
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it('skips unchanged pages on timer updates and force-checks without unnecessary edits', async () => {
    const f = fixture();
    const pages = [payload('stable history')];
    await f.publish(pages);
    const sent = f.messages.get('101')!;
    // Discord returns the same embed with its default type and another key order.
    sent.embeds = [{description: 'stable history', type: 'rich', title: 'Session history', url: sent.embeds[0].url}];
    f.channel.messages.fetch.mockClear();
    await f.publish([payload('stable history')]);
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
    await f.publish(pages, {force: true});
    expect(f.channel.messages.fetch).toHaveBeenCalledOnce();
    expect(sent.edit).not.toHaveBeenCalled();
    sent.embeds[0].description = 'changed outside publisher';
    await f.publish(pages, {force: true});
    expect(sent.edit).toHaveBeenCalledOnce();
  });

  it('edits only the changed continuation and detects a missing page on forced publication', async () => {
    const f = fixture();
    await f.publish([payload('first'), payload('second')]);
    const first = f.messages.get('101')!;
    const second = f.messages.get('102')!;
    await f.publish([payload('first'), payload('second updated')]);
    expect(first.edit).not.toHaveBeenCalled();
    expect(second.edit).toHaveBeenCalledOnce();
    f.messages.delete('101');
    await f.publish([payload('first'), payload('second updated')], {force: true});
    expect(f.bindings.get('session')?.get(1)).toBe('103');
  });

  it('forgets only the requested session cache', async () => {
    const f = fixture();
    await f.publish([payload('first')]);
    await f.publish([payload('other')], undefined, session('other'));
    f.channel.messages.fetch.mockClear();
    f.publisher.forget('session');
    await f.publish([payload('first')]);
    await f.publish([payload('other')], undefined, session('other'));
    expect(f.channel.messages.fetch).toHaveBeenCalledTimes(1);
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({message: '101', force: true});
  });

  it('never edits or deletes the primary card, even with an invalid binding', async () => {
    const f = fixture();
    const primary = f.seed(1, '100');
    await expect(f.publish([payload('history')])).rejects.toThrow('primary session card');
    expect(primary.edit).not.toHaveBeenCalled();
    expect(primary.delete).not.toHaveBeenCalled();
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it('recreates the suffix in chronological order after the first history page is deleted', async () => {
    const f = fixture(1564000000000000010n);
    const record = {...session(), messageId: '1564000000000000000'};
    f.seed(1, '1564000000000000001', payload('first'));
    const second = f.seed(2, '1564000000000000002', payload('second'));
    const third = f.seed(3, '1564000000000000003', payload('third'));
    f.messages.delete('1564000000000000001');
    await f.publish([payload('first'), payload('second'), payload('third')], {force: true}, record);
    expect([...f.bindings.get('session')!.values()]).toEqual(['1564000000000000010', '1564000000000000011', '1564000000000000012']);
    expect([...f.messages.keys()]).toEqual(['1564000000000000010', '1564000000000000011', '1564000000000000012']);
    expect(second.delete).toHaveBeenCalledOnce();
    expect(third.delete).toHaveBeenCalledOnce();
    expect(f.events.indexOf('delete:1564000000000000002')).toBeLessThan(f.events.indexOf('send:1564000000000000011'));
  });

  it('retains the prefix and recreates only the suffix after a middle page disappears', async () => {
    const f = fixture(1564000000000000010n);
    const record = {...session(), messageId: '1564000000000000000'};
    const first = f.seed(1, '1564000000000000001', payload('first'));
    f.seed(2, '1564000000000000002', payload('second'));
    const third = f.seed(3, '1564000000000000003', payload('third'));
    const pages = [payload('first'), payload('second'), payload('third')];
    await f.publish(pages, undefined, record);
    first.edit.mockClear();
    f.messages.delete('1564000000000000002');
    await f.publish(pages, {force: true}, record);
    expect([...f.bindings.get('session')!.values()]).toEqual(['1564000000000000001', '1564000000000000010', '1564000000000000011']);
    expect(first.edit).not.toHaveBeenCalled();
    expect(first.delete).not.toHaveBeenCalled();
    expect(third.delete).toHaveBeenCalledOnce();
  });

  it('moves every continuation after a replaced primary card despite unchanged cached bodies', async () => {
    const f = fixture(1564000000000000010n);
    const record = {...session(), messageId: '1564000000000000000'};
    const first = f.seed(1, '1564000000000000001', payload('first'));
    const second = f.seed(2, '1564000000000000002', payload('second'));
    const pages = [payload('first'), payload('second')];
    await f.publish(pages, undefined, record);
    await f.publish(pages, undefined, {...record, messageId: '1564000000000000009'});
    expect(first.delete).toHaveBeenCalledOnce();
    expect(second.delete).toHaveBeenCalledOnce();
    expect([...f.bindings.get('session')!.values()]).toEqual(['1564000000000000010', '1564000000000000011']);
  });

  it('retains an out-of-order binding when deletion fails and retries without duplicating the new prefix', async () => {
    const f = fixture(1564000000000000010n);
    const record = {...session(), messageId: '1564000000000000000'};
    f.seed(1, '1564000000000000001', payload('first'));
    const second = f.seed(2, '1564000000000000002', payload('second'));
    f.messages.delete('1564000000000000001');
    second.delete.mockRejectedValueOnce({code: 50013});
    const pages = [payload('first'), payload('second')];
    await expect(f.publish(pages, undefined, record)).rejects.toEqual({code: 50013});
    expect(f.bindings.get('session')?.get(2)).toBe('1564000000000000002');
    expect(f.channel.send).toHaveBeenCalledOnce();
    await f.publish(pages, undefined, record);
    expect(f.channel.send).toHaveBeenCalledTimes(2);
    expect([...f.bindings.get('session')!.values()]).toEqual(['1564000000000000010', '1564000000000000011']);
  });

  it('recovers a suffix after restart when its old message was removed but its replacement send failed', async () => {
    const f = fixture(1564000000000000010n);
    const record = {...session(), messageId: '1564000000000000000'};
    f.seed(1, '1564000000000000001', payload('first'));
    f.seed(2, '1564000000000000002', payload('second'));
    f.messages.delete('1564000000000000001');
    const send = f.channel.send.getMockImplementation()!;
    f.channel.send.mockImplementationOnce(send).mockRejectedValueOnce(new Error('network'));
    const pages = [payload('first'), payload('second')];
    await expect(f.publish(pages, undefined, record)).rejects.toThrow('network');
    expect(f.intents.get('session')?.has(2)).toBe(true);
    expect([...f.messages.keys()]).toEqual(['1564000000000000010']);
    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, record, pages, {force: true});
    expect([...f.bindings.get('session')!.values()]).toEqual(['1564000000000000010', '1564000000000000011']);
    expect([...f.messages.keys()]).toEqual(['1564000000000000010', '1564000000000000011']);
  });

  it('does not send unless its intent has been persisted', async () => {
    const f = fixture();
    f.store.beginHistoryMessage.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.publish([payload('first')])).rejects.toThrow('database unavailable');
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it('adopts a marked send after Discord accepted it but its response was lost', async () => {
    const f = fixture();
    const send = f.channel.send.getMockImplementation()!;
    f.channel.send.mockImplementationOnce(async value => {
      await send(value);
      throw new Error('response lost');
    });
    await expect(f.publish([payload('first')])).rejects.toThrow('response lost');
    expect(f.intents.get('session')?.get(1)).toBe('100');
    expect(f.bindings.get('session')).toBeUndefined();
    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, session(), [payload('first')]);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    expect(f.intents.get('session')?.size).toBe(0);
    expect(f.messages.get('101')?.edit).not.toHaveBeenCalled();
  });

  it('sends after restart if the persisted intent never reached Discord', async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error('send never accepted'));
    await expect(f.publish([payload('first')])).rejects.toThrow('send never accepted');
    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, session(), [payload('first')]);
    expect(f.messages.size).toBe(1);
    expect(f.store.beginHistoryMessage).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    const first = f.channel.send.mock.calls[0][0] as MessagePayload;
    const retried = f.channel.send.mock.calls[1][0] as MessagePayload;
    expect(first.body?.nonce).toMatch(/^[\da-f]{24}$/);
    expect(retried.body?.nonce).toBe(first.body?.nonce);
    expect(first.body?.nonce).toBe(f.store.beginHistoryMessage.mock.calls[0][3]);
  });

  it('matches only its own bot and exact session-position fragment after the anchor', async () => {
    const f = fixture();
    const foreign = await f.channel.send(markedPayload('foreign author'));
    foreign.author.id = 'someone-else';
    await f.channel.send(markedPayload('another position', 2));
    f.intents.set('session', new Map([[1, '100']]));
    f.channel.send.mockClear();
    await f.publish([payload('first')]);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('103');
    expect(foreign.delete).not.toHaveBeenCalled();
  });

  it('does not adopt an earlier message with the same marker outside its intent range', async () => {
    const f = fixture();
    const earlier = await f.channel.send(markedPayload('previous publication'));
    f.intents.set('session', new Map([[1, earlier.id]]));
    await f.publish([payload('first')]);
    expect(f.bindings.get('session')?.get(1)).toBe('102');
    expect(earlier.edit).not.toHaveBeenCalled();
  });

  it('scans more than one Discord history page before reusing an accepted send', async () => {
    const f = fixture();
    await f.channel.send(markedPayload('first'));
    for (let index = 0; index < 120; index++) await f.channel.send(payload('unrelated chat'));
    f.intents.set('session', new Map([[1, '100']]));
    f.channel.send.mockClear();
    await f.publish([payload('first')]);
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({limit: 100, cache: false, before: '122'});
  });

  it('fails closed when history cannot be read', async () => {
    const f = fixture();
    f.intents.set('session', new Map([[1, '100']]));
    f.channel.messages.fetch.mockRejectedValueOnce({code: 50013});
    await expect(f.publish([payload('first')])).rejects.toEqual({code: 50013});
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.intents.get('session')?.get(1)).toBe('100');
  });

  it('fails closed when the bounded scan cannot reach the intent anchor', async () => {
    const f = fixture();
    f.intents.set('session', new Map([[1, '100']]));
    f.channel.messages.fetch.mockImplementation(async options => {
      const newest = 'before' in options && options.before ? BigInt(options.before) - 1n : 20000n;
      return new Collection(Array.from({length: 100}, (_, index) => {
        const id = String(newest - BigInt(index));
        return [id, {id, author: {id: 'other'}, embeds: []}] as const;
      })) as never;
    });
    await expect(f.publish([payload('first')])).rejects.toThrow('scan limit');
    expect(f.channel.messages.fetch).toHaveBeenCalledTimes(100);
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it('removes an accepted but unbound continuation when a later render needs fewer pages', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('obsolete'));
    f.intents.set('session', new Map([[1, '100']]));
    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, session(), []);
    expect(sent.delete).toHaveBeenCalledOnce();
    expect(f.store.deleteHistoryMessage).toHaveBeenCalledWith('session', 1);
    expect(f.intents.get('session')?.size).toBe(0);
  });

  it('retains an obsolete pending intent when removing its accepted send is denied', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('obsolete'));
    sent.delete.mockRejectedValueOnce({code: 50013});
    f.intents.set('session', new Map([[1, '100']]));
    await expect(f.publish([])).rejects.toEqual({code: 50013});
    expect(f.store.deleteHistoryMessage).not.toHaveBeenCalled();
    expect(f.bindings.get('session')?.get(1)).toBe(sent.id);
    expect(f.intents.get('session')?.size).toBe(0);
  });

  it('uses a fresh nonce if an obsolete recovered page is needed again after binding cleanup fails', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('obsolete'));
    f.intents.set('session', new Map([[1, '100']]));
    f.store.deleteHistoryMessage.mockRejectedValueOnce(new Error('binding cleanup unavailable'));
    await expect(f.publish([])).rejects.toThrow('binding cleanup unavailable');
    expect(f.events.indexOf('bind:session:1:101')).toBeLessThan(f.events.indexOf('delete:101'));
    expect(sent.delete).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    expect(f.intents.get('session')?.size).toBe(0);

    // Repacking needs this position again before obsolete cleanup is retried.
    await f.publish([payload('needed again')]);
    const resent = f.channel.send.mock.calls[1][0] as MessagePayload;
    expect(resent.body?.nonce).toMatch(/^[\da-f]{24}$/);
    expect(resent.body?.nonce).not.toBe('111111111111111111111111');
    expect(f.store.beginHistoryMessage).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('102');
    expect(f.messages.size).toBe(1);
  });

  it('replaces a reconciled pending send that predates the new primary card', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('first'));
    f.intents.set('session', new Map([[1, '100']]));
    f.nextSnowflake(301n);
    await f.publish([payload('first')], undefined, {...session(), messageId: '300'});
    expect(sent.delete).toHaveBeenCalledOnce();
    expect(f.store.beginHistoryMessage).toHaveBeenCalledWith('session', 1, '300', expect.stringMatching(/^[\da-f]{24}$/));
    expect(f.store.beginHistoryMessage.mock.calls[0][3]).not.toBe('111111111111111111111111');
    expect(f.bindings.get('session')?.get(1)).toBe('301');
    expect(f.messages.get('301')?.embeds[0].url).toBe('https://discord.com/channels/guild/channel/300#muse-history=session:1');
  });

  it('retires the recovered nonce before deletion when persisting the replacement intent fails', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('first'));
    f.intents.set('session', new Map([[1, '100']]));
    f.nextSnowflake(301n);
    f.store.beginHistoryMessage.mockRejectedValueOnce(new Error('new intent unavailable'));
    const record = {...session(), messageId: '300'};
    await expect(f.publish([payload('first')], undefined, record)).rejects.toThrow('new intent unavailable');
    expect(f.events.indexOf('bind:session:1:101')).toBeLessThan(f.events.indexOf('delete:101'));
    expect(sent.delete).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
    expect(f.intents.get('session')?.size).toBe(0);

    const restarted = new SessionHistoryPublisher(f.store);
    await restarted.publish(f.channel as never, record, [payload('first')]);
    expect(f.bindings.get('session')?.get(1)).toBe('301');
    const resent = f.channel.send.mock.calls[1][0] as MessagePayload;
    expect(resent.body?.nonce).toMatch(/^[\da-f]{24}$/);
    expect(resent.body?.nonce).not.toBe('111111111111111111111111');
    expect(f.messages.size).toBe(1);
  });

  it('keeps a recovered accepted message if saving its binding before reordering fails', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('first'));
    f.intents.set('session', new Map([[1, '100']]));
    f.store.saveHistoryMessage.mockRejectedValueOnce(new Error('binding unavailable'));
    await expect(f.publish([payload('first')], undefined, {...session(), messageId: '300'})).rejects.toThrow('binding unavailable');
    expect(sent.delete).not.toHaveBeenCalled();
    expect(f.messages.get('101')).toBe(sent);
    expect(f.intents.get('session')?.get(1)).toBe('100');
    expect(f.store.beginHistoryMessage).not.toHaveBeenCalled();
    expect(f.channel.send).toHaveBeenCalledOnce();
  });

  it('preserves enforced nonces through real discord.js serialization and deduplicates a simulated POST retry', async () => {
    const f = fixture();
    const send = f.channel.send.getMockImplementation()!;
    const accepted = new Map<string, Awaited<ReturnType<typeof send>>>();
    const wireBodies: Array<{nonce: string; enforce_nonce: boolean; allowed_mentions: {parse: string[]}}> = [];
    const deliver = async (body: unknown) => {
      const wire = JSON.parse(JSON.stringify(body)) as typeof wireBodies[number];
      wireBodies.push(wire);
      const existing = wire.enforce_nonce && accepted.get(wire.nonce);
      if (existing) return existing;
      const message = await send(wire as never);
      accepted.set(wire.nonce, message);
      return message;
    };
    const post = vi.fn(async (_route: string, {body}: {body: unknown}) => {
      await deliver(body); // Discord accepts the first POST; its response is lost.
      return deliver(body); // The REST handler retries the same serialized body.
    });
    const channel = {
      ...f.channel,
      messages: {...f.channel.messages, cache: new Collection(), _add: (message: {id: string}) => f.messages.get(message.id)},
      client: {...f.channel.client, rest: {post}},
      send: vi.fn(async (options: MessagePayload) => TextChannel.prototype.send.call(channel as never, options)),
    };
    await f.publisher.publish(channel as never, session(), [payload('first')]);
    expect(channel.send.mock.calls[0][0]).toBeInstanceOf(MessagePayload);
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toBe('/channels/channel/messages');
    expect(wireBodies).toHaveLength(2);
    expect(wireBodies[0].nonce).toMatch(/^[\da-f]{24}$/);
    expect(wireBodies[0].nonce).toBe(f.store.beginHistoryMessage.mock.calls[0][3]);
    expect(wireBodies[1]).toEqual(wireBodies[0]);
    expect(wireBodies[0].enforce_nonce).toBe(true);
    expect(wireBodies[0].allowed_mentions.parse).toEqual([]);
    expect(f.messages.size).toBe(1);
    expect(f.bindings.get('session')?.get(1)).toBe('101');
  });

  it('retains a pending intent on empty history and adopts its accepted send once access returns', async () => {
    const f = fixture();
    const send = f.channel.send.getMockImplementation()!;
    f.channel.send.mockImplementationOnce(async value => {
      await send(value);
      throw new Error('response lost');
    });
    await expect(f.publish([payload('first')])).rejects.toThrow('response lost');
    const restarted = new SessionHistoryPublisher(f.store);
    f.channel.messages.fetch.mockResolvedValueOnce(new Collection());
    await expect(restarted.publish(f.channel as never, session(), [payload('first')])).rejects.toThrow('history is unavailable');
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.intents.get('session')?.get(1)).toBe('100');
    await restarted.publish(f.channel as never, session(), [payload('first')]);
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.bindings.get('session')?.get(1)).toBe('101');
  });

  it('does not erase an obsolete pending binding when reconciliation returns empty history', async () => {
    const f = fixture();
    const sent = await f.channel.send(markedPayload('obsolete'));
    f.intents.set('session', new Map([[1, '100']]));
    f.channel.messages.fetch.mockResolvedValueOnce(new Collection());
    await expect(f.publish([])).rejects.toThrow('history is unavailable');
    expect(f.store.deleteHistoryMessage).not.toHaveBeenCalled();
    expect(sent.delete).not.toHaveBeenCalled();
    expect(f.intents.get('session')?.get(1)).toBe('100');
  });

  it('fails closed when a later reconciliation page becomes empty', async () => {
    const f = fixture();
    f.intents.set('session', new Map([[1, '100']]));
    const first = new Collection(Array.from({length: 100}, (_, index) => {
      const id = String(1000 - index);
      return [id, {id, author: {id: 'other'}, embeds: []}] as const;
    }));
    f.channel.messages.fetch.mockResolvedValueOnce(first as never).mockResolvedValueOnce(new Collection());
    await expect(f.publish([payload('first')])).rejects.toThrow('history is unavailable');
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.store.saveHistoryMessage).not.toHaveBeenCalled();
  });
});
