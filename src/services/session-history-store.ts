import type {PrismaClient, Prisma} from '@prisma/client';
import {prisma} from '../utils/db.js';
import type {ListeningSessionRecord, ListeningSessionEntryStatus} from './listening-session.js';

type StoredSession = Prisma.ListeningSessionGetPayload<{include: {entries: true}}>;
type SavedState = {session: string; entries: Map<string, string>};

const validateHistoryMessagePosition = (position: number): void => {
  if (!Number.isInteger(position) || position < 1 || position > 2_147_483_647) {
    throw new RangeError('History message positions must be positive 32-bit integers.');
  }
};

const toRecord = (session: StoredSession): ListeningSessionRecord => ({
  id: session.id,
  guildId: session.guildId,
  voiceChannelId: session.voiceChannelId,
  channelId: session.channelId,
  messageId: session.messageId,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
  endReason: session.endReason,
  entries: session.entries.map(({sessionId, position, status, ...entry}) => ({
    ...entry,
    status: status as ListeningSessionEntryStatus,
  })),
});

export default class SessionHistoryStore {
  private readonly saved = new Map<string, SavedState>();

  constructor(private readonly database: PrismaClient = prisma) {}

  async save(record: ListeningSessionRecord): Promise<void> {
    const {entries, ...session} = record;
    const previous = this.saved.get(session.id);
    const state: SavedState = {session: JSON.stringify(session), entries: new Map()};
    const changedEntries = entries.flatMap((entry, position) => {
      const serialized = JSON.stringify(entry);
      state.entries.set(entry.id, serialized);
      return previous?.entries.get(entry.id) === serialized ? [] : [{...entry, position, sessionId: session.id}];
    });

    if (previous?.session === state.session && changedEntries.length === 0) {
      return;
    }

    await this.database.$transaction(async transaction => {
      if (previous?.session !== state.session) {
        // Closing can race the final Discord edit or the card's first send.
        // Keep the recap recoverable until publication is acknowledged.
        const durableSession = {...session, ...(session.endedAt ? {recoveryPending: true} : {})};
        await transaction.listeningSession.upsert({
          where: {id: session.id},
          create: durableSession,
          update: durableSession,
        });
      }

      await Promise.all(changedEntries.map(async entry => transaction.listeningSessionEntry.upsert({
        where: {id: entry.id},
        create: entry,
        update: entry,
      })));
    });

    if (record.endedAt) {
      this.saved.delete(record.id);
    } else {
      this.saved.set(record.id, state);
    }
  }

  async load(sessionId: string, guildId: string): Promise<ListeningSessionRecord | null> {
    const session = await this.database.listeningSession.findFirst({
      where: {id: sessionId, guildId},
      include: {entries: {orderBy: {position: 'asc'}}},
    });
    return session ? toRecord(session) : null;
  }

  async loadHistoryMessages(sessionId: string): Promise<Array<{position: number; messageId: string | null; afterMessageId: string | null; nonce: string | null}>> {
    return this.database.listeningSessionMessage.findMany({
      where: {sessionId},
      select: {position: true, messageId: true, afterMessageId: true, nonce: true},
      orderBy: {position: 'asc'},
    });
  }

  async beginHistoryMessage(sessionId: string, position: number, afterMessageId: string, nonce: string): Promise<void> {
    validateHistoryMessagePosition(position);
    await this.database.listeningSessionMessage.upsert({
      where: {sessionId_position: {sessionId, position}},
      create: {sessionId, position, messageId: null, afterMessageId, nonce},
      update: {messageId: null, afterMessageId, nonce},
    });
  }

  async saveHistoryMessage(sessionId: string, position: number, messageId: string): Promise<void> {
    validateHistoryMessagePosition(position);
    await this.database.listeningSessionMessage.upsert({
      where: {sessionId_position: {sessionId, position}},
      create: {sessionId, position, messageId, afterMessageId: null, nonce: null},
      update: {messageId, afterMessageId: null, nonce: null},
    });
  }

  async deleteHistoryMessage(sessionId: string, position: number): Promise<void> {
    validateHistoryMessagePosition(position);
    await this.database.listeningSessionMessage.deleteMany({where: {sessionId, position}});
  }

  async interruptOpenSessions(): Promise<ListeningSessionRecord[]> {
    const interrupted = await this.database.$transaction(async transaction => {
      const open = await transaction.listeningSession.findMany({
        where: {endedAt: null},
        select: {id: true},
      });
      const ids = open.map(session => session.id);
      if (ids.length > 0) {
        const now = new Date();
        await transaction.listeningSessionEntry.updateMany({
          where: {sessionId: {in: ids}, status: 'playing'},
          data: {status: 'interrupted', endedAt: now},
        });
        await transaction.listeningSession.updateMany({
          where: {id: {in: ids}},
          data: {endReason: 'interrupted', endedAt: now, recoveryPending: true},
        });
      }

      return transaction.listeningSession.findMany({
        where: {recoveryPending: true},
        include: {entries: {orderBy: {position: 'asc'}}},
        orderBy: {startedAt: 'asc'},
      });
    });

    for (const session of interrupted) {
      this.saved.delete(session.id);
    }

    return interrupted.map(session => toRecord(session));
  }

  async markRecovered(sessionId: string): Promise<void> {
    await this.database.listeningSession.updateMany({
      where: {id: sessionId, recoveryPending: true},
      data: {recoveryPending: false},
    });
  }
}
