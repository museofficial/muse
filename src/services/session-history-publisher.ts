/* eslint-disable no-await-in-loop -- Bind each Discord page before proceeding to the next side effect. */
import {randomBytes} from 'node:crypto';
import {EmbedBuilder, MessagePayload, type GuildTextBasedChannel, type Message} from 'discord.js';
import type {buildSessionMessages} from '../utils/build-session-message.js';
import type {ListeningSessionRecord} from './listening-session.js';
import type SessionHistoryStore from './session-history-store.js';

type HistoryStore = Pick<SessionHistoryStore, 'loadHistoryMessages' | 'beginHistoryMessage' | 'saveHistoryMessage' | 'deleteHistoryMessage'>;
type Payload = ReturnType<typeof buildSessionMessages>[number];
type CachedPublication = {messageId: string; body: string};
type Binding = {position: number; messageId: string | null; afterMessageId: string | null; nonce: string | null};

const isMissingMessage = (error: unknown): boolean => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 10008);
const isNotAfter = (messageId: string, previousId: string | null): boolean => previousId !== null
  && /^\d+$/.test(messageId) && /^\d+$/.test(previousId) && BigInt(messageId) <= BigInt(previousId);
const marker = (sessionId: string, position: number): string => `#muse-history=${sessionId}:${position}`;

// Discord adds the default embed type and may return object keys in a different order.
const bodyKey = ({content, embeds, components}: Pick<Payload, 'content' | 'embeds' | 'components'> | Pick<Message, 'content' | 'embeds' | 'components'>): string => JSON.stringify(
  {content, embeds, components},
  (key, value: unknown) => {
    if (key === 'type' && value === 'rich') {
      return undefined;
    }

    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value;
  },
);

const deleteMessage = async (message: Message): Promise<void> => {
  try {
    await message.delete();
  } catch (error: unknown) {
    if (!isMissingMessage(error)) {
      throw error;
    }
  }
};

const hasMarker = (message: Message, expected: string, botId: string): boolean => {
  if (message.author.id !== botId || !message.embeds[0]?.url) {
    return false;
  }

  try {
    return new URL(message.embeds[0].url).hash === expected;
  } catch {
    return false;
  }
};

/** The caller serializes publication with the session's primary card updates. */
export default class SessionHistoryPublisher {
  private readonly cache = new Map<string, Map<number, CachedPublication>>();

  constructor(private readonly store: HistoryStore) {}

  async publish(channel: GuildTextBasedChannel, session: ListeningSessionRecord, payloads: ReturnType<typeof buildSessionMessages>, options: {force?: boolean} = {}): Promise<void> {
    const bindings = await this.store.loadHistoryMessages(session.id);
    if (bindings.some(binding => binding.messageId !== null && binding.messageId === session.messageId)) {
      throw new Error('A history continuation cannot replace the primary session card.');
    }

    const cache = this.cache.get(session.id) ?? new Map<number, CachedPublication>();
    this.cache.set(session.id, cache);
    const byPosition = new Map(bindings.map(binding => [binding.position, binding]));
    let previousId = session.messageId;
    for (const [index, payload] of payloads.entries()) {
      previousId = await this.publishPage(channel, session, payload, {
        position: index + 1, binding: byPosition.get(index + 1), cache, force: options.force, previousId,
      });
    }

    // Keep old continuations until every desired page is safely published.
    for (const binding of bindings.filter(entry => entry.position > payloads.length).sort((left, right) => left.position - right.position)) {
      const message = await this.findMessage(channel, session.id, binding);
      if (message) {
        if (binding.messageId === null) {
          // Retire a recovered send's nonce before deletion, even if removing
          // the obsolete binding fails and this position becomes needed again.
          await this.store.saveHistoryMessage(session.id, binding.position, message.id);
        }

        await deleteMessage(message);
      }

      cache.delete(binding.position);
      await this.store.deleteHistoryMessage(session.id, binding.position);
    }
  }

  forget(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  private async publishPage(channel: GuildTextBasedChannel, session: ListeningSessionRecord, payload: Payload, page: {position: number; binding?: Binding; cache: Map<number, CachedPublication>; force?: boolean; previousId: string | null}): Promise<string> {
    const {position, binding, cache, force, previousId} = page;
    if (!session.messageId) {
      throw new Error('Publish the primary session card before its history.');
    }

    const marked = {...payload, embeds: [...payload.embeds]};
    marked.embeds[0] = EmbedBuilder.from(payload.embeds[0]).setURL(
      `https://discord.com/channels/${session.guildId}/${channel.id}/${session.messageId}${marker(session.id, position)}`,
    );
    const body = bodyKey(marked);
    const previous = cache.get(position);
    if (!force && binding?.messageId && previous?.messageId === binding.messageId && previous.body === body && !isNotAfter(binding.messageId, previousId)) {
      return binding.messageId;
    }

    cache.delete(position);
    const found = binding ? await this.findMessage(channel, session.id, binding) : undefined;
    if (found && binding?.messageId === null && isNotAfter(found.id, previousId)) {
      // Retire the recovered send's nonce before intentional deletion. If the
      // next intent fails, recovery sees a missing bound message, not that nonce.
      await this.store.saveHistoryMessage(session.id, position, found.id);
    }

    let message = found ? await this.refreshPage(found, marked, {body, previousId}) : undefined;
    if (!message) {
      let nonce = binding?.nonce;
      // Keep an existing unresolved intent when its scan proves no send exists.
      // A deleted/out-of-order message starts a fresh intent after its removal.
      if (!binding || binding.messageId !== null || found) {
        nonce = await this.beginPage(channel, session.id, position);
      }

      if (!nonce || !/^[\da-f]{24}$/.test(nonce)) {
        throw new Error('A history publication intent has no valid nonce.');
      }

      message = await this.sendPage(channel, marked, nonce);
    }

    if (binding?.messageId !== message.id) {
      // Keep accepted sends if persistence fails: their durable intent and
      // marker let the next publication adopt them without another POST.
      await this.store.saveHistoryMessage(session.id, position, message.id);
    }

    cache.set(position, {messageId: message.id, body});
    return message.id;
  }

  private async beginPage(channel: GuildTextBasedChannel, sessionId: string, position: number): Promise<string> {
    const latest = (await channel.messages.fetch({limit: 1, cache: false})).first();
    if (!latest || !/^\d+$/.test(latest.id)) {
      throw new Error('Could not establish a history publication anchor.');
    }

    const nonce = randomBytes(12).toString('hex');
    await this.store.beginHistoryMessage(sessionId, position, latest.id, nonce);
    return nonce;
  }

  private async sendPage(channel: GuildTextBasedChannel, payload: Payload, nonce: string): Promise<Message> {
    const transport = MessagePayload.create(channel, {...payload, nonce}).resolveBody();
    if (!transport.body) {
      throw new Error('Could not construct a history message payload.');
    }

    // Pinned discord.js omits enforce_nonce from its options, but preserves a
    // resolved MessagePayload body. Deduplicate its internal POST retries too.
    // https://docs.discord.com/developers/resources/message#create-message
    Object.assign(transport.body, {enforce_nonce: true});
    return channel.send(transport);
  }

  private async findMessage(channel: GuildTextBasedChannel, sessionId: string, binding: Binding): Promise<Message | undefined> {
    if (binding.messageId === null) {
      return this.recoverSend(channel, sessionId, binding);
    }

    try {
      return await channel.messages.fetch({message: binding.messageId, force: true});
    } catch (error: unknown) {
      if (!isMissingMessage(error)) {
        throw error;
      }

      return undefined;
    }
  }

  private async recoverSend(channel: GuildTextBasedChannel, sessionId: string, binding: Binding): Promise<Message | undefined> {
    const botId = channel.client.user?.id;
    if (!botId || !binding.afterMessageId || !/^\d+$/.test(binding.afterMessageId)) {
      throw new Error('A history publication intent cannot be reconciled.');
    }

    const anchor = BigInt(binding.afterMessageId);
    const expected = marker(sessionId, binding.position);
    let before: string | undefined;
    let found: Message | undefined;
    for (let page = 0; page < 100; page++) {
      const batch = await channel.messages.fetch({limit: 100, cache: false, ...(before ? {before} : {})});
      // Discord also returns [] without READ_MESSAGE_HISTORY. It cannot prove
      // that a pending send is absent, even after a nonempty earlier page.
      if (batch.size === 0) {
        throw new Error('Discord history is unavailable for publication reconciliation.');
      }

      let oldest: bigint | undefined;
      for (const message of batch.values()) {
        if (!/^\d+$/.test(message.id)) {
          throw new Error('Discord returned an invalid history message ID.');
        }

        const id = BigInt(message.id);
        oldest = oldest === undefined || id < oldest ? id : oldest;
        if (id > anchor && hasMarker(message, expected, botId)) {
          if (found && found.id !== message.id) {
            throw new Error('Multiple messages match a history publication intent.');
          }

          found = message;
        }
      }

      if (oldest === undefined) {
        throw new Error('Discord returned no history message IDs.');
      }

      if (oldest <= anchor || batch.size < 100) {
        return found;
      }

      if (before && oldest >= BigInt(before)) {
        throw new Error('Discord history pagination did not advance.');
      }

      before = String(oldest);
    }

    throw new Error('History publication reconciliation exceeded its scan limit.');
  }

  private async refreshPage(message: Message, payload: Payload, {body, previousId}: {body: string; previousId: string | null}): Promise<Message | undefined> {
    try {
      if (isNotAfter(message.id, previousId)) {
        // Remove out-of-order pages before replacing their durable binding.
        await deleteMessage(message);
        return undefined;
      }

      if (bodyKey(message) !== body) {
        await message.edit(payload);
      }

      return message;
    } catch (error: unknown) {
      if (!isMissingMessage(error)) {
        throw error;
      }

      return undefined;
    }
  }
}
