import Prisma from '@prisma/client';
import {execa} from 'execa';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import ListeningSession from '../src/services/listening-session.js';
import SessionHistoryStore from '../src/services/session-history-store.js';
import {MediaSource} from '../src/services/player-types.js';

const song = {
  title: 'Original song',
  artist: 'Artist',
  url: 'original-video',
  source: MediaSource.Youtube,
  length: 195.25,
  offset: 2.5,
  requestedBy: 'listener',
};

describe('durable listening history', () => {
  it('migrates SQLite, preserves ordered history across restart, and finalizes interrupted sessions', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-session-history-'));
    const databaseUrl = `file:${path.join(directory, 'db.sqlite')}?connection_limit=1`;
    let first: InstanceType<typeof Prisma.PrismaClient> | undefined;
    let reopened: InstanceType<typeof Prisma.PrismaClient> | undefined;
    try {
      await execa('prisma', ['migrate', 'deploy'], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });
      first = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const store = new SessionHistoryStore(first);
      const session = new ListeningSession('guild', store);
      session.startTrack(song, 'voice', 1);
      await session.setMessage('text', 'player-message');
      session.endTrack('completed');
      session.startTrack({...song, title: 'Skipped song'}, 'voice', 2);
      session.endTrack('skipped');
      session.startTrack({...song, title: 'Interrupted song'}, 'voice', 3);
      await session.flush();
      const original = session.snapshot()!;
      const stopped = new ListeningSession('other-guild', store);
      stopped.startTrack(song, 'other-voice', 1);
      stopped.finish('stopped');
      await stopped.flush();
      const stoppedRecord = stopped.snapshot()!;
      await store.markRecovered(stoppedRecord.id);
      await first.$disconnect();
      first = undefined;

      reopened = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const restartedStore = new SessionHistoryStore(reopened);
      await expect(restartedStore.load(original.id, 'wrong-guild')).resolves.toBeNull();
      await expect(restartedStore.load('unknown-session', 'guild')).resolves.toBeNull();
      await expect(restartedStore.load(original.id, 'guild')).resolves.toEqual(original);
      const interrupted = await restartedStore.interruptOpenSessions();
      expect(interrupted).toHaveLength(1);
      expect(interrupted[0]).toMatchObject({
        id: original.id,
        channelId: 'text',
        messageId: 'player-message',
        endedAt: expect.any(Date),
        endReason: 'interrupted',
      });
      expect(interrupted[0].entries.map(entry => entry.title)).toEqual(['Original song', 'Skipped song', 'Interrupted song']);
      expect(interrupted[0].entries.map(entry => entry.status)).toEqual(['completed', 'skipped', 'interrupted']);
      expect(interrupted[0].entries.every(entry => entry.endedAt instanceof Date)).toBe(true);
      expect(interrupted[0].entries[0]).toEqual(original.entries[0]);
      await expect(restartedStore.load(original.id, 'guild')).resolves.toEqual(interrupted[0]);
      await expect(restartedStore.load(stoppedRecord.id, 'other-guild')).resolves.toEqual(stoppedRecord);
      await expect(restartedStore.interruptOpenSessions()).resolves.toEqual(interrupted);
      await restartedStore.markRecovered(original.id);
      await expect(restartedStore.interruptOpenSessions()).resolves.toEqual([]);
    } finally {
      await first?.$disconnect();
      await reopened?.$disconnect();
      await fs.rm(directory, {recursive: true, force: true});
    }
  }, 25_000);

  it('retries pending terminal recaps across failed startups and clears only after publication is acknowledged', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-session-recovery-'));
    const databaseUrl = `file:${path.join(directory, 'db.sqlite')}?connection_limit=1`;
    let database: InstanceType<typeof Prisma.PrismaClient> | undefined;
    try {
      await execa('prisma', ['migrate', 'deploy'], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });
      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const store = new SessionHistoryStore(database);
      let terminalWriteFailed = false;
      const session = new ListeningSession('guild', {save: async record => {
        if (record.endedAt && !terminalWriteFailed) {
          terminalWriteFailed = true;
          throw new Error('Transient write failure');
        }

        await store.save(record);
      }});
      session.prepare('voice', 'private-channel');
      session.startTrack(song, 'voice', 1);
      session.finish('stopped');
      const terminal = session.snapshot()!;
      await vi.waitFor(async () => expect(await store.load(terminal.id, 'guild')).toEqual(terminal));
      expect(terminalWriteFailed).toBe(true);
      await expect(store.interruptOpenSessions()).resolves.toEqual([terminal]);
      expect(await database.listeningSession.findUnique({where: {id: terminal.id}}))
        .toMatchObject({recoveryPending: true, channelId: 'private-channel', messageId: null});
      // Simulate startup ending before Discord can publish the missing recap.
      await database.$disconnect();

      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const afterFailedStartup = new SessionHistoryStore(database);
      await expect(afterFailedStartup.interruptOpenSessions()).resolves.toEqual([terminal]);
      const bound = {...terminal, messageId: 'replacement-card'};
      await afterFailedStartup.save(bound);
      // Simulate publication and binding succeeding, but acknowledgement failing.
      await database.$disconnect();

      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const afterFailedAcknowledgement = new SessionHistoryStore(database);
      await expect(afterFailedAcknowledgement.interruptOpenSessions()).resolves.toEqual([bound]);
      await afterFailedAcknowledgement.markRecovered(terminal.id);
      await expect(afterFailedAcknowledgement.interruptOpenSessions()).resolves.toEqual([]);
      await expect(afterFailedAcknowledgement.load(terminal.id, 'guild')).resolves.toEqual(bound);
      expect(await database.listeningSession.findUnique({where: {id: terminal.id}}))
        .toMatchObject({recoveryPending: false, channelId: 'private-channel', messageId: 'replacement-card', endReason: 'stopped', endedAt: terminal.endedAt});
      expect(bound).not.toHaveProperty('recoveryPending');
    } finally {
      await database?.$disconnect();
      await fs.rm(directory, {recursive: true, force: true});
    }
  }, 25_000);

  it('writes only new or changed entries as the session grows and skips identical saves', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-session-history-writes-'));
    const databaseUrl = `file:${path.join(directory, 'db.sqlite')}?connection_limit=1`;
    let database: InstanceType<typeof Prisma.PrismaClient> | undefined;
    try {
      await execa('prisma', ['migrate', 'deploy'], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });
      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const entryWrites: string[] = [];
      database.$use(async (params, next) => {
        if (params.model === 'ListeningSessionEntry' && params.action === 'upsert') {
          entryWrites.push(params.args.where.id);
        }
        return next(params);
      });
      const store = new SessionHistoryStore(database);
      const session = new ListeningSession('guild', store);
      session.startTrack(song, 'voice', 1);
      session.endTrack('completed');
      await session.flush();
      const firstEntry = session.snapshot()!.entries[0].id;
      expect(entryWrites).toEqual([firstEntry, firstEntry]);
      entryWrites.length = 0;
      session.startTrack(song, 'voice', 2);
      await session.flush();
      const secondEntry = session.snapshot()!.entries[1].id;
      expect(entryWrites).toEqual([secondEntry]);
      await store.save(session.snapshot()!);
      await session.setMessage('text', 'player-message');
      expect(entryWrites).toEqual([secondEntry]);
      session.finish('stopped');
      await session.flush();
      expect(entryWrites).toEqual([secondEntry, secondEntry]);
    } finally {
      await database?.$disconnect();
      await fs.rm(directory, {recursive: true, force: true});
    }
  }, 25_000);
});
