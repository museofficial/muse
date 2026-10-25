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
  it('preserves independent overflow-message bindings across playback saves, restarts, and recovery', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-session-history-messages-'));
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
      const session = new ListeningSession('guild', store);
      session.prepare('voice', 'private-channel');
      session.startTrack(song, 'voice', 1);
      await session.setMessage('private-channel', 'main-card');
      const id = session.snapshot()!.id;
      await store.saveHistoryMessage(id, 2, 'history-two');
      await store.saveHistoryMessage(id, 1, 'history-one');
      await store.saveHistoryMessage(id, 1, 'history-one-replaced');
      await store.beginHistoryMessage(id, 3, 'history-two', '00112233445566778899aabb');
      const bindings = [
        {position: 1, messageId: 'history-one-replaced', afterMessageId: null, nonce: null},
        {position: 2, messageId: 'history-two', afterMessageId: null, nonce: null},
        {position: 3, messageId: null, afterMessageId: 'history-two', nonce: '00112233445566778899aabb'},
      ];
      await expect(store.loadHistoryMessages(id)).resolves.toEqual(bindings);
      await expect(store.loadHistoryMessages('unknown-session')).resolves.toEqual([]);

      session.endTrack('completed');
      session.startTrack({...song, title: 'Second song'}, 'voice', 2);
      session.finish('stopped');
      await session.flush();
      const terminal = session.snapshot()!;
      await expect(store.loadHistoryMessages(id)).resolves.toEqual(bindings);
      expect(terminal).not.toHaveProperty('historyMessages');
      await database.$disconnect();

      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const restarted = new SessionHistoryStore(database);
      await expect(restarted.load(id, 'guild')).resolves.toEqual(terminal);
      await expect(restarted.interruptOpenSessions()).resolves.toEqual([terminal]);
      await expect(restarted.loadHistoryMessages(id)).resolves.toEqual(bindings);
      await restarted.saveHistoryMessage(id, 3, 'history-three');
      const completedBindings = [...bindings.slice(0, 2), {position: 3, messageId: 'history-three', afterMessageId: null, nonce: null}];
      await restarted.markRecovered(id);
      await expect(restarted.loadHistoryMessages(id)).resolves.toEqual(completedBindings);
      await restarted.deleteHistoryMessage(id, 1);
      await restarted.deleteHistoryMessage(id, 1);
      await expect(restarted.loadHistoryMessages(id)).resolves.toEqual(completedBindings.slice(1));
      await database.listeningSession.delete({where: {id}});
      await expect(restarted.loadHistoryMessages(id)).resolves.toEqual([]);
    } finally {
      await database?.$disconnect();
      await fs.rm(directory, {recursive: true, force: true});
    }
  }, 25_000);

  it('upgrades the deployed session schema and marks existing recaps for public-history conversion', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-session-history-upgrade-'));
    const databaseUrl = `file:${path.join(directory, 'db.sqlite')}?connection_limit=1`;
    const previousSchemaDirectory = path.join(directory, 'previous');
    const newMigration = '20261024233000_add_session_history_messages';
    let database: InstanceType<typeof Prisma.PrismaClient> | undefined;
    try {
      await fs.mkdir(path.join(previousSchemaDirectory, 'migrations'), {recursive: true});
      await fs.copyFile('schema.prisma', path.join(previousSchemaDirectory, 'schema.prisma'));
      const previousMigrations = (await fs.readdir('migrations')).filter(name => name !== newMigration);
      await Promise.all(previousMigrations.map(async name => fs.cp(
        path.join('migrations', name),
        path.join(previousSchemaDirectory, 'migrations', name),
        {recursive: true},
      )));
      await execa('prisma', ['migrate', 'deploy', '--schema', path.join(previousSchemaDirectory, 'schema.prisma')], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });
      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const oldStore = new SessionHistoryStore(database);
      const oldSession = new ListeningSession('guild', oldStore);
      oldSession.prepare('voice', 'private-channel');
      oldSession.startTrack(song, 'voice', 1);
      await oldSession.setMessage('private-channel', 'old-recap');
      oldSession.finish('stopped');
      await oldSession.flush();
      const original = oldSession.snapshot()!;
      await oldStore.markRecovered(original.id);
      expect(await database.listeningSession.findUnique({where: {id: original.id}})).toMatchObject({recoveryPending: false});
      await database.$disconnect();

      await execa('prisma', ['migrate', 'deploy'], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });
      database = new Prisma.PrismaClient({datasources: {db: {url: databaseUrl}}});
      const upgraded = new SessionHistoryStore(database);
      expect(await database.listeningSession.findUnique({where: {id: original.id}}))
        .toMatchObject({recoveryPending: true, channelId: 'private-channel', messageId: 'old-recap'});
      await expect(upgraded.interruptOpenSessions()).resolves.toEqual([original]);
      await expect(upgraded.loadHistoryMessages(original.id)).resolves.toEqual([]);
      await upgraded.saveHistoryMessage(original.id, 1, 'public-history');
      await expect(upgraded.interruptOpenSessions()).resolves.toEqual([original]);
      await expect(upgraded.loadHistoryMessages(original.id)).resolves.toEqual([{position: 1, messageId: 'public-history', afterMessageId: null, nonce: null}]);
      await upgraded.markRecovered(original.id);
      await expect(upgraded.interruptOpenSessions()).resolves.toEqual([]);
      const applied = await database.$queryRawUnsafe<Array<{migration_name: string}>>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
      );
      expect(applied.map(row => row.migration_name)).toEqual(expect.arrayContaining([
        '20261024170000_add_listening_sessions', newMigration,
      ]));
    } finally {
      await database?.$disconnect();
      await fs.rm(directory, {recursive: true, force: true});
    }
  }, 30_000);

  it('rejects invalid overflow positions before writing or deleting a binding', async () => {
    const model = {upsert: vi.fn(), deleteMany: vi.fn()};
    const store = new SessionHistoryStore({listeningSessionMessage: model} as never);
    for (const position of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
      await expect(store.beginHistoryMessage('session', position, 'anchor', '00112233445566778899aabb')).rejects.toBeInstanceOf(RangeError);
      await expect(store.saveHistoryMessage('session', position, 'message')).rejects.toBeInstanceOf(RangeError);
      await expect(store.deleteHistoryMessage('session', position)).rejects.toBeInstanceOf(RangeError);
    }

    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.deleteMany).not.toHaveBeenCalled();
  });

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
