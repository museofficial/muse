import Prisma from '@prisma/client';
import {execa} from 'execa';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';

describe('migration orchestration', () => {
  it('derives absolute, relative, and escaped Windows paths without query parameters', async () => {
    const {createDatabasePathFromUrl} = await import('../src/utils/create-database-url.js');

    expect(createDatabasePathFromUrl('file:/srv/muse/db.sqlite?socket_timeout=10&connection_limit=1'))
      .toBe('/srv/muse/db.sqlite');
    expect(createDatabasePathFromUrl('file:./data/db.sqlite?connection_limit=1'))
      .toBe('./data/db.sqlite');
    expect(createDatabasePathFromUrl('file:C:\\\\Muse Data\\\\db.sqlite?connection_limit=1', 'win32'))
      .toBe('C:\\Muse Data\\db.sqlite');
  });

  it('deploys a fresh database, reports success, and starts without legacy probes', async () => {
    const {runMigrationsAndStart} = await import('../src/utils/run-migrations-and-start.js');
    const sequence: string[] = [];
    const hasPrismaMigrations = vi.fn();
    const resolveInitialMigration = vi.fn();

    await runMigrationsAndStart({
      databaseExists: vi.fn(async () => {
        sequence.push('exists');
        return false;
      }),
      deployMigrations: vi.fn(async () => {
        sequence.push('deploy');
      }),
      hasPrismaMigrations,
      migrationsApplied: vi.fn(() => {
        sequence.push('success');
      }),
      resolveInitialMigration,
      startBot: vi.fn(async () => {
        sequence.push('start');
      }),
    });

    expect(sequence).toEqual(['exists', 'deploy', 'success', 'start']);
    expect(hasPrismaMigrations).not.toHaveBeenCalled();
    expect(resolveInitialMigration).not.toHaveBeenCalled();
  });

  it('resolves the initial migration before deploying and starting a pre-Prisma database', async () => {
    const {runMigrationsAndStart} = await import('../src/utils/run-migrations-and-start.js');
    const sequence: string[] = [];

    await runMigrationsAndStart({
      databaseExists: vi.fn(async () => {
        sequence.push('exists');
        return true;
      }),
      hasPrismaMigrations: vi.fn(async () => {
        sequence.push('unmigrated');
        return false;
      }),
      resolveInitialMigration: vi.fn(async () => {
        sequence.push('resolve');
      }),
      deployMigrations: vi.fn(async () => {
        sequence.push('deploy');
      }),
      migrationsApplied: vi.fn(() => {
        sequence.push('success');
      }),
      startBot: vi.fn(async () => {
        sequence.push('start');
      }),
    });

    expect(sequence).toEqual(['exists', 'unmigrated', 'resolve', 'deploy', 'success', 'start']);
  });

  it('skips initial resolution for an already-migrated database', async () => {
    const {runMigrationsAndStart} = await import('../src/utils/run-migrations-and-start.js');
    const sequence: string[] = [];
    const resolveInitialMigration = vi.fn();

    await runMigrationsAndStart({
      databaseExists: vi.fn(async () => {
        sequence.push('exists');
        return true;
      }),
      hasPrismaMigrations: vi.fn(async () => {
        sequence.push('migrated');
        return true;
      }),
      resolveInitialMigration,
      deployMigrations: vi.fn(async () => {
        sequence.push('deploy');
      }),
      migrationsApplied: vi.fn(() => {
        sequence.push('success');
      }),
      startBot: vi.fn(async () => {
        sequence.push('start');
      }),
    });

    expect(sequence).toEqual(['exists', 'migrated', 'deploy', 'success', 'start']);
    expect(resolveInitialMigration).not.toHaveBeenCalled();
  });

  it('does not deploy, report success, or start when initial resolution fails', async () => {
    const {runMigrationsAndStart} = await import('../src/utils/run-migrations-and-start.js');
    const failure = new Error('initial resolution failed');
    const deployMigrations = vi.fn();
    const migrationsApplied = vi.fn();
    const startBot = vi.fn();

    await expect(runMigrationsAndStart({
      databaseExists: vi.fn().mockResolvedValue(true),
      deployMigrations,
      hasPrismaMigrations: vi.fn().mockResolvedValue(false),
      migrationsApplied,
      resolveInitialMigration: vi.fn().mockRejectedValue(failure),
      startBot,
    })).rejects.toBe(failure);

    expect(deployMigrations).not.toHaveBeenCalled();
    expect(migrationsApplied).not.toHaveBeenCalled();
    expect(startBot).not.toHaveBeenCalled();
  });

  it('does not report success or start when deployment fails', async () => {
    const {runMigrationsAndStart} = await import('../src/utils/run-migrations-and-start.js');
    const failure = new Error('migration failed');
    const migrationsApplied = vi.fn();
    const startBot = vi.fn();

    await expect(runMigrationsAndStart({
      databaseExists: vi.fn().mockResolvedValue(false),
      deployMigrations: vi.fn().mockRejectedValue(failure),
      hasPrismaMigrations: vi.fn(),
      migrationsApplied,
      resolveInitialMigration: vi.fn(),
      startBot,
    })).rejects.toBe(failure);

    expect(migrationsApplied).not.toHaveBeenCalled();
    expect(startBot).not.toHaveBeenCalled();
  });

  it('detects an explicit SQLite DATABASE_URL instead of the default DATA_DIR database', async () => {
    const explicitDatabasePath = path.join(os.tmpdir(), 'explicit-muse.sqlite');
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const access = vi.fn().mockResolvedValue(undefined);
    const startBot = vi.fn().mockResolvedValue(undefined);
    const queryRaw = vi.fn().mockResolvedValue([{count: 1}]);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const spinner = {
      fail: vi.fn(),
      start: vi.fn(),
      succeed: vi.fn(),
    };
    spinner.start.mockReturnValue(spinner);

    vi.resetModules();
    vi.doMock('fs', () => ({promises: {access}}));
    vi.doMock('ora', () => ({default: vi.fn(() => spinner)}));
    vi.doMock('execa', () => ({execa: vi.fn().mockResolvedValue(undefined)}));
    vi.doMock('@prisma/client', () => ({
      default: {
        Prisma: {PrismaClientKnownRequestError: class extends Error {}},
        PrismaClient: class {
          $disconnect = disconnect;
          $queryRaw = queryRaw;
        },
      },
    }));
    vi.doMock('../src/index.js', () => ({startBot}));
    vi.doMock('../src/services/config.js', () => ({DATA_DIR: path.join(os.tmpdir(), 'default-muse-data')}));
    vi.doMock('../src/utils/log-banner.js', () => ({default: vi.fn()}));
    process.env.DATABASE_URL = `file:${explicitDatabasePath}?socket_timeout=10&connection_limit=1`;

    try {
      await import('../src/scripts/migrate-and-start.js');
      await vi.waitFor(() => {
        expect(startBot).toHaveBeenCalledOnce();
      });

      expect(access).toHaveBeenCalledWith(explicitDatabasePath);
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }

      vi.doUnmock('fs');
      vi.doUnmock('ora');
      vi.doUnmock('execa');
      vi.doUnmock('@prisma/client');
      vi.doUnmock('../src/index.js');
      vi.doUnmock('../src/services/config.js');
      vi.doUnmock('../src/utils/log-banner.js');
      vi.resetModules();
    }
  });
});

describe('SQLite persistence', () => {
  it('resolves and deploys a real pre-Prisma SQLite database before the start callback', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-legacy-migration-'));
    const databasePath = path.join(tempDirectory, 'db.sqlite');
    const databaseUrl = `file:${databasePath}?socket_timeout=10&connection_limit=1`;
    const prismaEnvironment = {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'};
    let probeClient: InstanceType<typeof Prisma.PrismaClient> | undefined;
    let reopenedClient: InstanceType<typeof Prisma.PrismaClient> | undefined;

    try {
      await execa('prisma', [
        'db',
        'execute',
        '--file',
        'migrations/20220101155430_migrate_from_sequelize/migration.sql',
        '--schema',
        'schema.prisma',
      ], {
        env: prismaEnvironment,
        preferLocal: true,
        timeout: 15_000,
      });
      probeClient = new Prisma.PrismaClient({
        datasources: {db: {url: databaseUrl}},
      });
      const legacyTables = await probeClient.$queryRawUnsafe<Array<{name: string}>>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      );
      expect(legacyTables.map(({name}) => name)).toEqual(expect.arrayContaining([
        'FileCaches',
        'KeyValueCaches',
        'Settings',
      ]));
      expect(legacyTables.map(({name}) => name)).not.toContain('_prisma_migrations');

      const {runMigrationsAndStart} = await import('../src/utils/run-migrations-and-start.js');
      const sequence: string[] = [];
      await runMigrationsAndStart({
        databaseExists: async () => {
          sequence.push('exists');
          await fs.access(databasePath);
          return true;
        },
        hasPrismaMigrations: async () => {
          sequence.push('unmigrated');
          try {
            await probeClient!.$queryRawUnsafe('SELECT COUNT(id) FROM _prisma_migrations');
            return true;
          } catch (error: unknown) {
            expect(error).toMatchObject({code: 'P2010'});
            return false;
          } finally {
            await probeClient!.$disconnect();
            probeClient = undefined;
          }
        },
        resolveInitialMigration: async () => {
          sequence.push('resolve');
          await execa('prisma', [
            'migrate',
            'resolve',
            '--applied',
            '20220101155430_migrate_from_sequelize',
          ], {
            env: prismaEnvironment,
            preferLocal: true,
            timeout: 15_000,
          });
        },
        deployMigrations: async () => {
          sequence.push('deploy');
          await execa('prisma', ['migrate', 'deploy'], {
            env: prismaEnvironment,
            preferLocal: true,
            timeout: 15_000,
          });
        },
        migrationsApplied: () => {
          sequence.push('success');
        },
        startBot: async () => {
          sequence.push('start');
          reopenedClient = new Prisma.PrismaClient({
            datasources: {db: {url: databaseUrl}},
          });
          await Promise.all([
            reopenedClient.setting.count(),
            reopenedClient.favoriteQuery.count(),
            reopenedClient.fileCache.count(),
            reopenedClient.keyValueCache.count(),
          ]);
        },
      });

      expect(sequence).toEqual(['exists', 'unmigrated', 'resolve', 'deploy', 'success', 'start']);
      const appliedMigrations = await reopenedClient!.$queryRawUnsafe<Array<{
        finished_at: Date | null;
        migration_name: string;
      }>>('SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name');
      expect(appliedMigrations).toHaveLength(19);
      expect(appliedMigrations.every(({finished_at: finishedAt}) => finishedAt !== null)).toBe(true);
      expect(appliedMigrations.map(({migration_name: name}) => name))
        .toContain('20220101155430_migrate_from_sequelize');
    } finally {
      await probeClient?.$disconnect();
      await reopenedClient?.$disconnect();
      await fs.rm(tempDirectory, {force: true, recursive: true});
    }
  }, 30_000);

  it('reopens every durable model while a fresh PlayerManager starts with an empty in-memory queue', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-ops-persistence-'));
    const databasePath = path.join(tempDirectory, 'db.sqlite');
    const databaseUrl = `file:${databasePath}?socket_timeout=10&connection_limit=1`;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    let firstClient: InstanceType<typeof Prisma.PrismaClient> | undefined;
    let reopenedClient: InstanceType<typeof Prisma.PrismaClient> | undefined;

    try {
      await execa('prisma', ['migrate', 'deploy'], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });

      firstClient = new Prisma.PrismaClient({
        datasources: {db: {url: databaseUrl}},
      });
      const accessedAt = new Date('2026-07-12T12:00:00.000Z');
      const expiresAt = new Date('2026-07-12T13:00:00.000Z');

      await firstClient.setting.create({
        data: {guildId: 'persistent-guild', playlistLimit: 37},
      });
      await firstClient.favoriteQuery.create({
        data: {
          authorId: 'persistent-author',
          guildId: 'persistent-guild',
          name: 'persistent-favorite',
          query: 'persistent query',
        },
      });
      await firstClient.fileCache.create({
        data: {accessedAt, bytes: 1234, hash: 'persistent-file-hash'},
      });
      await firstClient.keyValueCache.create({
        data: {expiresAt, key: 'persistent-key', value: JSON.stringify({answer: 42})},
      });
      await firstClient.$disconnect();
      firstClient = undefined;

      reopenedClient = new Prisma.PrismaClient({
        datasources: {db: {url: databaseUrl}},
      });

      await expect(reopenedClient.setting.findUnique({where: {guildId: 'persistent-guild'}}))
        .resolves.toEqual(expect.objectContaining({guildId: 'persistent-guild', playlistLimit: 37}));
      await expect(reopenedClient.favoriteQuery.findUnique({
        where: {guildId_name: {guildId: 'persistent-guild', name: 'persistent-favorite'}},
      })).resolves.toEqual(expect.objectContaining({
        authorId: 'persistent-author',
        query: 'persistent query',
      }));
      await expect(reopenedClient.fileCache.findUnique({where: {hash: 'persistent-file-hash'}}))
        .resolves.toEqual(expect.objectContaining({accessedAt, bytes: 1234}));
      await expect(reopenedClient.keyValueCache.findUnique({where: {key: 'persistent-key'}}))
        .resolves.toEqual(expect.objectContaining({expiresAt, value: JSON.stringify({answer: 42})}));

      process.env.DATABASE_URL = databaseUrl;
      vi.doMock('../src/utils/get-guild-settings.js', () => ({
        getGuildSettings: vi.fn(),
      }));
      const {default: PlayerManager} = await import('../src/managers/player.js');
      const fileCache = {};
      const youtubeAPI = {findAudioFallback: vi.fn().mockResolvedValue(null)};
      const firstManager = new PlayerManager(fileCache as never, youtubeAPI as never);
      firstManager.get('persistent-guild').add({
        addedInChannelId: 'persistent-channel',
        artist: 'Persistent artist',
        isLive: false,
        length: 180,
        offset: 0,
        playlist: null,
        requestedBy: 'persistent-author',
        source: 0,
        thumbnailUrl: null,
        title: 'Only in memory',
        url: 'persistent-video',
      });

      const reopenedManager = new PlayerManager(fileCache as never, youtubeAPI as never);
      expect(firstManager.get('persistent-guild').getCurrent()?.title).toBe('Only in memory');
      expect(reopenedManager.get('persistent-guild').getCurrent()).toBeNull();
      expect(reopenedManager.get('persistent-guild').getQueue()).toEqual([]);
    } finally {
      const restoreEnvironment = (name: string, value: string | undefined) => {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      };

      restoreEnvironment('DATABASE_URL', originalDatabaseUrl);
      vi.doUnmock('../src/utils/get-guild-settings.js');
      await firstClient?.$disconnect();
      await reopenedClient?.$disconnect();
      await fs.rm(tempDirectory, {force: true, recursive: true});
    }
  }, 20_000);

  it('runs the supported clear command against only KeyValueCache rows', async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-cache-clear-'));
    const databasePath = path.join(tempDirectory, 'db.sqlite');
    const databaseUrl = `file:${databasePath}?socket_timeout=10&connection_limit=1`;
    let seedClient: InstanceType<typeof Prisma.PrismaClient> | undefined;
    let reopenedClient: InstanceType<typeof Prisma.PrismaClient> | undefined;

    try {
      await execa('prisma', ['migrate', 'deploy'], {
        env: {...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info'},
        preferLocal: true,
        timeout: 15_000,
      });
      seedClient = new Prisma.PrismaClient({
        datasources: {db: {url: databaseUrl}},
      });
      await seedClient.setting.create({
        data: {guildId: 'cache-clear-guild', playlistLimit: 23},
      });
      await seedClient.favoriteQuery.create({
        data: {
          authorId: 'cache-clear-author',
          guildId: 'cache-clear-guild',
          name: 'cache-clear-favorite',
          query: 'keep this favorite',
        },
      });
      await seedClient.fileCache.create({
        data: {
          accessedAt: new Date('2026-07-12T15:00:00.000Z'),
          bytes: 2048,
          hash: 'cache-clear-file',
        },
      });
      await seedClient.keyValueCache.create({
        data: {
          expiresAt: new Date('2026-07-12T16:00:00.000Z'),
          key: 'cache-clear-key',
          value: JSON.stringify({remove: true}),
        },
      });
      await seedClient.$disconnect();
      seedClient = undefined;

      await execa('npm', ['run', 'cache:clear-key-value'], {
        cwd: process.cwd(),
        env: {...process.env, DATABASE_URL: databaseUrl},
        timeout: 15_000,
      });

      reopenedClient = new Prisma.PrismaClient({
        datasources: {db: {url: databaseUrl}},
      });
      await expect(Promise.all([
        reopenedClient.setting.count(),
        reopenedClient.favoriteQuery.count(),
        reopenedClient.fileCache.count(),
        reopenedClient.keyValueCache.count(),
      ])).resolves.toEqual([1, 1, 1, 0]);
      await expect(reopenedClient.setting.findUnique({where: {guildId: 'cache-clear-guild'}}))
        .resolves.toEqual(expect.objectContaining({playlistLimit: 23}));
      await expect(reopenedClient.favoriteQuery.findUnique({
        where: {guildId_name: {guildId: 'cache-clear-guild', name: 'cache-clear-favorite'}},
      })).resolves.toEqual(expect.objectContaining({query: 'keep this favorite'}));
      await expect(reopenedClient.fileCache.findUnique({where: {hash: 'cache-clear-file'}}))
        .resolves.toEqual(expect.objectContaining({bytes: 2048}));
    } finally {
      await seedClient?.$disconnect();
      await reopenedClient?.$disconnect();
      await fs.rm(tempDirectory, {force: true, recursive: true});
    }
  }, 25_000);
});

const makeKeyValueCacheModel = () => ({
  delete: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
});

const loadKeyValueCache = async (keyValueCache: ReturnType<typeof makeKeyValueCacheModel>) => {
  vi.resetModules();
  vi.doMock('../src/utils/db.js', () => ({
    prisma: {keyValueCache},
  }));
  vi.doMock('../src/utils/debug.js', () => ({default: vi.fn()}));
  const {default: KeyValueCacheProvider} = await import('../src/services/key-value-cache.js');

  return new KeyValueCacheProvider();
};

const resetKeyValueCacheHarness = () => {
  vi.useRealTimers();
  vi.doUnmock('../src/utils/db.js');
  vi.doUnmock('../src/utils/debug.js');
  vi.resetModules();
};

describe('KeyValueCacheProvider expiration and persistence', () => {
  it('returns an unexpired parsed JSON hit without invoking or rewriting it', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date('2026-07-12T14:00:00.000Z'));
    const model = makeKeyValueCacheModel();
    model.findUnique.mockResolvedValue({
      expiresAt: new Date('2026-07-12T14:00:01.000Z'),
      key: 'unexpired-key',
      value: JSON.stringify({nested: ['cached', 42]}),
    });
    const wrapped = vi.fn().mockResolvedValue({wrong: true});

    try {
      const cache = await loadKeyValueCache(model);

      await expect(cache.wrap(wrapped, {expiresIn: 60, key: 'unexpired-key'}))
        .resolves.toEqual({nested: ['cached', 42]});
      expect(wrapped).not.toHaveBeenCalled();
      expect(model.delete).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
    } finally {
      resetKeyValueCacheHarness();
    }
  });

  it('deletes an expired row before refreshing and persists the replacement JSON', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date('2026-07-12T14:00:00.000Z'));
    const model = makeKeyValueCacheModel();
    model.findUnique.mockResolvedValue({
      expiresAt: new Date('2026-07-12T13:59:59.999Z'),
      key: 'expired-key',
      value: JSON.stringify({stale: true}),
    });
    model.delete.mockResolvedValue({});
    model.upsert.mockResolvedValue({});
    const wrapped = vi.fn().mockImplementation(async () => {
      expect(model.delete).toHaveBeenCalledWith({where: {key: 'expired-key'}});
      return {fresh: true};
    });

    try {
      const cache = await loadKeyValueCache(model);

      await expect(cache.wrap(wrapped, {expiresIn: 30, key: 'expired-key'}))
        .resolves.toEqual({fresh: true});
      expect(model.upsert).toHaveBeenCalledWith({
        where: {key: 'expired-key'},
        update: {
          expiresAt: new Date('2026-07-12T14:00:30.000Z'),
          value: JSON.stringify({fresh: true}),
        },
        create: {
          expiresAt: new Date('2026-07-12T14:00:30.000Z'),
          key: 'expired-key',
          value: JSON.stringify({fresh: true}),
        },
      });
    } finally {
      resetKeyValueCacheHarness();
    }
  });

  it('upserts a cache miss as JSON with the exact requested expiration', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date('2026-07-12T14:00:00.000Z'));
    const model = makeKeyValueCacheModel();
    model.findUnique.mockResolvedValue(null);
    model.upsert.mockResolvedValue({});
    const result = {items: [{id: 1}], nullable: null};

    try {
      const cache = await loadKeyValueCache(model);

      await expect(cache.wrap(vi.fn().mockResolvedValue(result), {expiresIn: 75, key: 'cache-miss-key'}))
        .resolves.toEqual(result);
      expect(model.delete).not.toHaveBeenCalled();
      expect(model.upsert).toHaveBeenCalledWith({
        where: {key: 'cache-miss-key'},
        update: {
          expiresAt: new Date('2026-07-12T14:01:15.000Z'),
          value: JSON.stringify(result),
        },
        create: {
          expiresAt: new Date('2026-07-12T14:01:15.000Z'),
          key: 'cache-miss-key',
          value: JSON.stringify(result),
        },
      });
    } finally {
      resetKeyValueCacheHarness();
    }
  });
});

describe('key-value cache TTL call-site contracts', () => {
  it('uses one hour for search, details, autocomplete, and SponsorBlock, but one minute for playlist reads', async () => {
    vi.resetModules();
    vi.doMock('../src/utils/db.js', () => ({prisma: {}}));
    vi.doMock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: vi.fn()}));
    vi.doMock('sponsorblock-api', () => ({
      SponsorBlock: class {
        async getSegments() {
          return [];
        }
      },
    }));

    try {
      const [
        {default: YoutubeAPI},
        {default: Play},
        {default: AddQueryToQueue},
      ] = await Promise.all([
        import('../src/services/youtube-api.js'),
        import('../src/commands/play.js'),
        import('../src/services/add-query-to-queue.js'),
      ]);
      const video = {
        contentDetails: {duration: 'PT3M', videoId: 'video-id'},
        id: 'video-id',
        snippet: {
          channelTitle: 'Test artist',
          description: '',
          liveBroadcastContent: 'none',
          thumbnails: {medium: {url: 'https://img.example/video.jpg'}},
          title: 'Test song',
        },
      };

      const searchCache = {
        wrap: vi.fn()
          .mockResolvedValueOnce({items: [{id: {videoId: 'video-id'}}]})
          .mockResolvedValueOnce({items: [video]}),
      };
      const searchApi = new YoutubeAPI({YOUTUBE_API_KEY: 'isolated-key'} as never, searchCache as never);
      await searchApi.search('isolated query', false);

      const playlistCache = {
        wrap: vi.fn()
          .mockResolvedValueOnce({
            items: [{
              contentDetails: {itemCount: 1},
              id: 'playlist-id',
              snippet: {title: 'Test playlist'},
            }],
          })
          .mockResolvedValueOnce({
            items: [{contentDetails: {videoId: 'video-id'}, id: 'playlist-item-id'}],
          })
          .mockResolvedValueOnce({items: [video]}),
      };
      const playlistApi = new YoutubeAPI({YOUTUBE_API_KEY: 'isolated-key'} as never, playlistCache as never);
      await playlistApi.getPlaylist('playlist-id', false);

      const autocompleteCache = {wrap: vi.fn().mockResolvedValue([])};
      const play = new Play(undefined as never, autocompleteCache as never, {} as never);
      const autocompleteInteraction = {
        options: {getString: vi.fn(() => 'isolated query')},
        respond: vi.fn().mockResolvedValue(undefined),
      };
      await play.handleAutocompleteInteraction(autocompleteInteraction as never);

      const sponsorBlockCache = {wrap: vi.fn().mockResolvedValue([])};
      const addQueryToQueue = new AddQueryToQueue(
        {} as never,
        {} as never,
        {ENABLE_SPONSORBLOCK: true, SPONSORBLOCK_TIMEOUT: 5} as never,
        sponsorBlockCache as never,
      );
      await (addQueryToQueue as unknown as {
        skipNonMusicSegments(song: object): Promise<object>;
      }).skipNonMusicSegments({
        artist: 'Test artist',
        isLive: false,
        length: 180,
        offset: 0,
        playlist: null,
        source: 0,
        thumbnailUrl: null,
        title: 'Test song',
        url: 'video-id',
      });

      const expirationValues = (cacheWrap: ReturnType<typeof vi.fn>) => cacheWrap.mock.calls
        .map(call => (call.at(-1) as {expiresIn: number}).expiresIn);
      expect({
        autocomplete: expirationValues(autocompleteCache.wrap),
        playlistMetadataItemsAndDetails: expirationValues(playlistCache.wrap),
        searchAndDetails: expirationValues(searchCache.wrap),
        sponsorBlock: expirationValues(sponsorBlockCache.wrap),
      }).toEqual({
        autocomplete: [3600],
        playlistMetadataItemsAndDetails: [60, 60, 3600],
        searchAndDetails: [3600, 3600],
        sponsorBlock: [3600],
      });
    } finally {
      vi.doUnmock('../src/utils/db.js');
      vi.doUnmock('../src/utils/get-guild-settings.js');
      vi.doUnmock('sponsorblock-api');
      vi.resetModules();
    }
  });
});
