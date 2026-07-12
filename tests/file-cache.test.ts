import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PQueue from 'p-queue';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  fileCache: {
    aggregate: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  rows: new Map<string, {
    hash: string;
    bytes: number;
    accessedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }>(),
}));

vi.mock('../src/utils/db.js', () => ({
  prisma: {fileCache: dependencyMocks.fileCache},
}));

vi.mock('../src/utils/debug.js', () => ({
  default: dependencyMocks.debug,
}));

import FileCacheProvider from '../src/services/file-cache.js';

const tempDirectories: string[] = [];

const makeRow = (hash: string, bytes: number, accessedAt = new Date()) => ({
  hash,
  bytes,
  accessedAt,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const installDatabaseFake = () => {
  const {fileCache, rows} = dependencyMocks;

  fileCache.aggregate.mockImplementation(async () => ({
    _sum: {
      bytes: [...rows.values()].reduce((total, row) => total + row.bytes, 0),
    },
  }));
  fileCache.create.mockImplementation(async ({data}: {data: {hash: string; bytes: number; accessedAt: Date}}) => {
    if (rows.has(data.hash)) {
      throw new Error(`Unique constraint failed for ${data.hash}`);
    }

    const row = makeRow(data.hash, data.bytes, data.accessedAt);
    rows.set(data.hash, row);
    return row;
  });
  fileCache.delete.mockImplementation(async ({where}: {where: {hash: string}}) => rows.delete(where.hash));
  fileCache.findFirst.mockImplementation(async () => [...rows.values()]
    .sort((first, second) => first.accessedAt.getTime() - second.accessedAt.getTime())[0] ?? null);
  fileCache.findMany.mockImplementation(async ({where, orderBy, take}: {
    where?: {
      hash?: {gt: string};
      createdAt?: {gt: Date};
    };
    orderBy?: {
      hash?: 'asc' | 'desc';
      createdAt?: 'asc' | 'desc';
    };
    take: number;
  }) => {
    const matchingRows = [...rows.values()].filter(row => (
      (!where?.hash || row.hash > where.hash.gt)
      && (!where?.createdAt || row.createdAt > where.createdAt.gt)
    ));

    if (orderBy?.hash) {
      const direction = orderBy.hash === 'asc' ? 1 : -1;
      matchingRows.sort((first, second) => direction * first.hash.localeCompare(second.hash));
    } else if (orderBy?.createdAt) {
      const direction = orderBy.createdAt === 'asc' ? 1 : -1;
      matchingRows.sort((first, second) => direction * (first.createdAt.getTime() - second.createdAt.getTime()));
    }

    return matchingRows.slice(0, take);
  });
  fileCache.findUnique.mockImplementation(async ({where}: {where: {hash: string}}) => rows.get(where.hash) ?? null);
  fileCache.update.mockImplementation(async ({where, data}: {where: {hash: string}; data: {accessedAt: Date}}) => {
    const row = rows.get(where.hash);
    if (!row) {
      throw new Error(`Missing cache row ${where.hash}`);
    }

    const updated = {...row, ...data, updatedAt: new Date()};
    rows.set(where.hash, updated);
    return updated;
  });
  fileCache.upsert.mockImplementation(async ({where, create, update}: {
    where: {hash: string};
    create: {hash: string; bytes: number; accessedAt: Date};
    update: {bytes: number; accessedAt: Date};
  }) => {
    const existing = rows.get(where.hash);
    const row = existing
      ? {...existing, ...update, updatedAt: new Date()}
      : makeRow(create.hash, create.bytes, create.accessedAt);
    rows.set(where.hash, row);
    return row;
  });
};

const makeProvider = async (cacheLimit = Number.MAX_SAFE_INTEGER) => {
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-file-cache-'));
  tempDirectories.push(cacheDirectory);
  await fs.mkdir(path.join(cacheDirectory, 'tmp'));

  const provider = new FileCacheProvider({
    CACHE_DIR: cacheDirectory,
    CACHE_LIMIT_IN_BYTES: cacheLimit,
  } as never);

  return {cacheDirectory, provider};
};

const waitForClose = (stream: NodeJS.WritableStream) => new Promise<void>(resolve => {
  stream.once('close', resolve);
});

const pathExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  dependencyMocks.rows.clear();
  installDatabaseFake();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirectories.splice(0).map(async directory => fs.rm(directory, {force: true, recursive: true})));
});

describe('FileCacheProvider concurrent finalization', () => {
  it('uses unique temporary paths and converges same-hash writers without an unhandled rejection', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const unhandledRejections: unknown[] = [];
    const captureUnhandled = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', captureUnhandled);

    try {
      const first = provider.createWriteStream('same-hash');
      const second = provider.createWriteStream('same-hash');
      const firstTemporaryPath = String(first.path);
      const secondTemporaryPath = String(second.path);
      const firstClosed = waitForClose(first);
      const secondClosed = waitForClose(second);

      first.end('writer-one');
      second.end('writer-two-is-longer');
      await Promise.all([firstClosed, secondClosed]);

      await vi.waitFor(async () => {
        expect(dependencyMocks.rows.size).toBe(1);
        expect(await fs.readdir(path.join(cacheDirectory, 'tmp'))).toEqual([]);
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      const finalContents = await fs.readFile(path.join(cacheDirectory, 'same-hash'), 'utf8');
      const row = dependencyMocks.rows.get('same-hash');
      expect(firstTemporaryPath).not.toBe(secondTemporaryPath);
      expect(['writer-one', 'writer-two-is-longer']).toContain(finalContents);
      expect(row?.bytes).toBe(Buffer.byteLength(finalContents));
      expect(dependencyMocks.fileCache.upsert).toHaveBeenCalled();
      expect(dependencyMocks.fileCache.create).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }
  });

  it('keeps every indexed file readable when cleanup is queued between final stat and upsert', async () => {
    const {cacheDirectory, provider} = await makeProvider(4);
    const existing = makeRow('same-hash', 4, new Date('2026-01-01T00:00:00Z'));
    const survivor = makeRow('survivor', 4, new Date('2026-01-02T00:00:00Z'));
    dependencyMocks.rows.set(existing.hash, existing);
    dependencyMocks.rows.set(survivor.hash, survivor);
    await fs.writeFile(path.join(cacheDirectory, existing.hash), 'old!');
    await fs.writeFile(path.join(cacheDirectory, survivor.hash), 'keep');

    let markUpsertStarted!: () => void;
    let releaseUpsert!: () => void;
    const upsertStarted = new Promise<void>(resolve => {
      markUpsertStarted = resolve;
    });
    const upsertCanFinish = new Promise<void>(resolve => {
      releaseUpsert = resolve;
    });
    const persistUpsert = dependencyMocks.fileCache.upsert.getMockImplementation();
    dependencyMocks.fileCache.upsert.mockImplementation(async args => {
      markUpsertStarted();
      await upsertCanFinish;
      return persistUpsert!(args);
    });

    const originalQueueAdd = PQueue.prototype.add;
    const observedQueues = new Set<PQueue>();
    const queueAdd = vi.spyOn(PQueue.prototype, 'add').mockImplementation(function (this: PQueue, ...args: any[]) {
      observedQueues.add(this);
      return Reflect.apply(originalQueueAdd, this, args);
    });
    const stream = provider.createWriteStream('same-hash');
    const streamErrors: unknown[] = [];
    stream.on('error', error => streamErrors.push(error));
    const closed = waitForClose(stream);
    stream.end('replacement-writer');
    await closed;
    await upsertStarted;

    const queueAddsBeforeCleanup = queueAdd.mock.calls.length;
    const cleanup = provider.cleanup();
    await vi.waitFor(() => {
      expect(queueAdd.mock.calls.length).toBeGreaterThan(queueAddsBeforeCleanup);
    });
    releaseUpsert();

    await cleanup;
    await vi.waitFor(async () => {
      expect(await fs.readdir(path.join(cacheDirectory, 'tmp'))).toEqual([]);
    });
    await Promise.all([...observedQueues].map(async queue => queue.onIdle()));

    expect(dependencyMocks.rows.size).toBe(1);
    for (const row of dependencyMocks.rows.values()) {
      const contents = await fs.readFile(path.join(cacheDirectory, row.hash));
      expect(contents.byteLength).toBe(row.bytes);
    }
    expect(streamErrors).toEqual([]);
  });

  it('removes a zero-byte temporary file without publishing or indexing it', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const stream = provider.createWriteStream('empty-hash');
    const closed = waitForClose(stream);

    stream.end();
    await closed;

    await vi.waitFor(async () => {
      expect(await fs.readdir(path.join(cacheDirectory, 'tmp'))).toEqual([]);
    });
    expect(await pathExists(path.join(cacheDirectory, 'empty-hash'))).toBe(false);
    expect(dependencyMocks.rows.has('empty-hash')).toBe(false);
    expect(dependencyMocks.fileCache.upsert).not.toHaveBeenCalled();
  });

  it('contains an atomic-finalization failure, removes its temporary file, and emits a stream error', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const failure = new Error('atomic finalization failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fs, 'link').mockRejectedValueOnce(failure);
    const stream = provider.createWriteStream('failed-hash');
    const streamErrors: unknown[] = [];
    const unhandledRejections: unknown[] = [];
    const captureUnhandled = (reason: unknown) => unhandledRejections.push(reason);
    stream.on('error', error => streamErrors.push(error));
    process.on('unhandledRejection', captureUnhandled);

    try {
      const closed = waitForClose(stream);
      stream.end('payload');
      await closed;

      await vi.waitFor(async () => {
        expect(streamErrors).toEqual([failure]);
        expect(await fs.readdir(path.join(cacheDirectory, 'tmp'))).toEqual([]);
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(await pathExists(path.join(cacheDirectory, 'failed-hash'))).toBe(false);
      expect(dependencyMocks.rows.has('failed-hash')).toBe(false);
      expect(consoleError).toHaveBeenCalledWith('Failed to finalize cache write:', failure);
      expect(dependencyMocks.debug).toHaveBeenCalledWith('Failed to finalize cache write: atomic finalization failed');
      expect(unhandledRejections).toEqual([]);

      const recovery = provider.createWriteStream('recovery-hash');
      const recoveryClosed = waitForClose(recovery);
      recovery.end('recovered');
      await recoveryClosed;
      await vi.waitFor(async () => {
        expect(await fs.readFile(path.join(cacheDirectory, 'recovery-hash'), 'utf8')).toBe('recovered');
        expect(dependencyMocks.rows.has('recovery-hash')).toBe(true);
      });
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }
  });

  it('logs a finalization failure when no stream error listener is attached', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const failure = new Error('unobserved finalization failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fs, 'link').mockRejectedValueOnce(failure);
    const unhandledRejections: unknown[] = [];
    const captureUnhandled = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', captureUnhandled);

    try {
      const stream = provider.createWriteStream('unobserved-failure');
      const closed = waitForClose(stream);
      stream.end('payload');
      await closed;

      await vi.waitFor(async () => {
        expect(dependencyMocks.debug).toHaveBeenCalledWith('Failed to finalize cache write: unobserved finalization failed');
        expect(await fs.readdir(path.join(cacheDirectory, 'tmp'))).toEqual([]);
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(consoleError).toHaveBeenCalledWith('Failed to finalize cache write:', failure);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }
  });

  it('discards a nonzero write destroyed with an error before finish', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const failure = new Error('source stream failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const link = vi.spyOn(fs, 'link');
    const stream = provider.createWriteStream('partial-hash');
    const temporaryPath = String(stream.path);
    const hasInternalErrorBoundary = stream.listenerCount('error') > 0;
    let finished = false;
    const uncaughtExceptions: Error[] = [];
    const unhandledRejections: unknown[] = [];
    const captureUncaught = (error: Error) => uncaughtExceptions.push(error);
    const captureUnhandled = (reason: unknown) => unhandledRejections.push(reason);

    // Keep the RED run deterministic instead of letting the missing production
    // boundary terminate Vitest. GREEN exercises only the production listener.
    if (!hasInternalErrorBoundary) {
      stream.on('error', () => {});
    }

    stream.once('finish', () => {
      finished = true;
    });
    process.on('uncaughtExceptionMonitor', captureUncaught);
    process.on('unhandledRejection', captureUnhandled);

    try {
      await new Promise<void>((resolve, reject) => {
        stream.write('partial payload', error => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      expect((await fs.stat(temporaryPath)).size).toBeGreaterThan(0);

      const closed = waitForClose(stream);
      stream.destroy(failure);
      await closed;

      await vi.waitFor(async () => {
        expect(await pathExists(temporaryPath)).toBe(false);
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(finished).toBe(false);
      expect(hasInternalErrorBoundary).toBe(true);
      expect(await pathExists(path.join(cacheDirectory, 'partial-hash'))).toBe(false);
      expect(dependencyMocks.rows.has('partial-hash')).toBe(false);
      expect(link).not.toHaveBeenCalled();
      expect(dependencyMocks.fileCache.upsert).not.toHaveBeenCalled();
      expect(dependencyMocks.fileCache.aggregate).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('Failed to write cache temporary file:', failure);
      expect(dependencyMocks.debug).toHaveBeenCalledWith('Failed to write cache temporary file: source stream failed');
      expect(uncaughtExceptions).toEqual([]);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('uncaughtExceptionMonitor', captureUncaught);
      process.off('unhandledRejection', captureUnhandled);
    }
  });

  it('discards a nonzero write destroyed without an error before finish', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const link = vi.spyOn(fs, 'link');
    const stream = provider.createWriteStream('aborted-hash');
    const temporaryPath = String(stream.path);
    let finished = false;
    stream.once('finish', () => {
      finished = true;
    });

    await new Promise<void>((resolve, reject) => {
      stream.write('partial payload', error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    expect((await fs.stat(temporaryPath)).size).toBeGreaterThan(0);

    const closed = waitForClose(stream);
    stream.destroy();
    await closed;

    await vi.waitFor(async () => {
      expect(await pathExists(temporaryPath)).toBe(false);
    });

    expect(finished).toBe(false);
    expect(await pathExists(path.join(cacheDirectory, 'aborted-hash'))).toBe(false);
    expect(dependencyMocks.rows.has('aborted-hash')).toBe(false);
    expect(link).not.toHaveBeenCalled();
    expect(dependencyMocks.fileCache.upsert).not.toHaveBeenCalled();
    expect(dependencyMocks.fileCache.aggregate).not.toHaveBeenCalled();
    expect(dependencyMocks.fileCache.findFirst).not.toHaveBeenCalled();
  });
});

describe('FileCacheProvider startup cleanup', () => {
  it('removes regular temporary-file orphans and leaves directories alone', async () => {
    const {cacheDirectory, provider} = await makeProvider();
    const temporaryDirectory = path.join(cacheDirectory, 'tmp');
    const orphanPath = path.join(temporaryDirectory, 'abandoned.123e4567-e89b-12d3-a456-426614174000');
    const preservedDirectory = path.join(temporaryDirectory, 'preserved-directory');
    const preservedFile = path.join(preservedDirectory, 'nested-file');
    await fs.writeFile(orphanPath, 'partial');
    await fs.mkdir(preservedDirectory);
    await fs.writeFile(preservedFile, 'keep');

    await provider.cleanup();

    expect(await pathExists(orphanPath)).toBe(false);
    expect(await pathExists(preservedDirectory)).toBe(true);
    expect(await fs.readFile(preservedFile, 'utf8')).toBe('keep');
  });

  it('removes every missing database row when more than one page shares a creation time', async () => {
    const {provider} = await makeProvider();
    const sharedCreatedAt = new Date('2026-01-01T00:00:00Z');
    const hashes = Array.from(
      {length: 51},
      (_, index) => `missing-${String(index).padStart(2, '0')}`,
    ).reverse();

    for (const hash of hashes) {
      dependencyMocks.rows.set(hash, {
        ...makeRow(hash, 1),
        createdAt: sharedCreatedAt,
      });
    }

    await provider.cleanup();

    expect(dependencyMocks.rows.size).toBe(0);
    expect(dependencyMocks.fileCache.delete).toHaveBeenCalledTimes(51);
    expect(dependencyMocks.fileCache.findMany).toHaveBeenCalledTimes(3);
    for (const [arguments_] of dependencyMocks.fileCache.findMany.mock.calls) {
      expect(arguments_).toEqual(expect.objectContaining({
        orderBy: {hash: 'asc'},
      }));
    }
  });
});

describe('FileCacheProvider eviction', () => {
  it('keeps concurrent eviction passes serialized', async () => {
    const {provider} = await makeProvider();
    let activePasses = 0;
    let aggregateCalls = 0;
    let maximumActivePasses = 0;
    dependencyMocks.fileCache.aggregate.mockImplementation(async () => {
      activePasses++;
      aggregateCalls++;
      maximumActivePasses = Math.max(maximumActivePasses, activePasses);
      await new Promise(resolve => setTimeout(resolve, 10));
      activePasses--;
      return {_sum: {bytes: 0}};
    });

    await Promise.all([provider.cleanup(), provider.cleanup()]);
    await vi.waitFor(() => {
      expect(activePasses).toBe(0);
    });

    expect(aggregateCalls).toBe(2);
    expect(maximumActivePasses).toBe(1);
  });

  it('preserves least-recently-accessed eviction order', async () => {
    const {cacheDirectory, provider} = await makeProvider(4);
    const oldest = makeRow('oldest', 4, new Date('2026-01-01T00:00:00Z'));
    const newest = makeRow('newest', 4, new Date('2026-01-02T00:00:00Z'));
    dependencyMocks.rows.set(oldest.hash, oldest);
    dependencyMocks.rows.set(newest.hash, newest);
    await fs.writeFile(path.join(cacheDirectory, oldest.hash), 'old!');
    await fs.writeFile(path.join(cacheDirectory, newest.hash), 'new!');

    await provider.cleanup();

    expect(dependencyMocks.fileCache.delete).toHaveBeenCalledWith({where: {hash: 'oldest'}});
    expect(dependencyMocks.rows.has('oldest')).toBe(false);
    expect(await pathExists(path.join(cacheDirectory, 'oldest'))).toBe(false);
    expect(dependencyMocks.rows.has('newest')).toBe(true);
    expect(await fs.readFile(path.join(cacheDirectory, 'newest'), 'utf8')).toBe('new!');
  });

  it('rejects cleanup after one no-progress check when usage is above limit but no row is evictable', async () => {
    const {provider} = await makeProvider(0);
    dependencyMocks.fileCache.aggregate
      .mockResolvedValueOnce({_sum: {bytes: 1}})
      .mockResolvedValue({_sum: {bytes: 0}});
    dependencyMocks.fileCache.findFirst.mockResolvedValue(null);

    await expect(provider.cleanup()).rejects.toThrow(/cache.*limit.*no.*evict/i);
    expect(dependencyMocks.fileCache.findFirst).toHaveBeenCalledTimes(1);
  });
});
