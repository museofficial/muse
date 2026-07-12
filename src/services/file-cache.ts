import {promises as fs, createWriteStream, WriteStream} from 'fs';
import {randomUUID} from 'crypto';
import path from 'path';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Config from './config.js';
import PQueue from 'p-queue';
import debug from '../utils/debug.js';
import {prisma} from '../utils/db.js';
import {FileCache} from '@prisma/client';

@injectable()
export default class FileCacheProvider {
  private static readonly mutationQueue = new PQueue({concurrency: 1});
  private readonly config: Config;

  constructor(@inject(TYPES.Config) config: Config) {
    this.config = config;
  }

  /**
   * Returns path to cached file if it exists, otherwise returns null.
   * Updates the `accessedAt` property of the cached file.
   * @param hash lookup key
   */
  async getPathFor(hash: string): Promise<string | null> {
    const model = await prisma.fileCache.findUnique({
      where: {
        hash,
      },
    });

    if (!model) {
      return null;
    }

    const resolvedPath = path.join(this.config.CACHE_DIR, hash);

    try {
      await fs.access(resolvedPath);
    } catch (_: unknown) {
      await prisma.fileCache.delete({
        where: {
          hash,
        },
      });

      return null;
    }

    await prisma.fileCache.update({
      where: {
        hash,
      },
      data: {
        accessedAt: new Date(),
      },
    });

    return resolvedPath;
  }

  /**
   * Returns a write stream for the given hash key.
   * The stream handles saving a new file and will
   * update the database after the stream is closed.
   * @param hash lookup key
   */
  createWriteStream(hash: string) {
    const tmpPath = path.join(this.config.CACHE_DIR, 'tmp', `${hash}.${randomUUID()}`);
    const finalPath = path.join(this.config.CACHE_DIR, hash);

    const stream = createWriteStream(tmpPath);
    let finished = false;
    let writeFailed = false;

    const handleWriteError = (error: unknown) => {
      writeFailed = true;
      this.reportWriteError(error);
    };

    stream.once('finish', () => {
      finished = true;
    });
    stream.once('error', handleWriteError);

    stream.once('close', () => {
      stream.removeListener('error', handleWriteError);

      const completion = finished && !writeFailed
        ? this.finalizeWrite(hash, tmpPath, finalPath)
        : this.removeTemporaryFile(tmpPath);

      void completion
        .catch(error => {
          this.reportFinalizationError(stream, error);
        });
    });

    return stream;
  }

  /**
   * Deletes orphaned cache files and evicts files if
   * necessary. Should be run on program startup so files
   * will be evicted if the cache limit has changed.
   */
  async cleanup() {
    await FileCacheProvider.mutationQueue.add(async () => {
      await this.removeOrphans();
      await this.evictOldest();
    });
  }

  private async finalizeWrite(hash: string, tmpPath: string, finalPath: string) {
    try {
      const temporaryStats = await fs.stat(tmpPath);

      await FileCacheProvider.mutationQueue.add(async () => {
        if (temporaryStats.size !== 0) {
          try {
            // Tmp and final are on one filesystem. A hard link publishes one
            // complete writer atomically without replacing an existing winner.
            await fs.link(tmpPath, finalPath);
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              throw error;
            }
          }

          const finalStats = await fs.stat(finalPath);
          const accessedAt = new Date();
          await prisma.fileCache.upsert({
            where: {
              hash,
            },
            create: {
              hash,
              accessedAt,
              bytes: finalStats.size,
            },
            update: {
              accessedAt,
              bytes: finalStats.size,
            },
          });
        }

        // This task already owns the mutation queue; enqueueing again here
        // would deadlock behind itself.
        await this.evictOldest();
      });
    } catch (error: unknown) {
      try {
        await this.removeTemporaryFile(tmpPath);
      } catch (cleanupError: unknown) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        debug(`Failed to clean up cache temporary file: ${message}`);
      }

      throw error;
    }

    await this.removeTemporaryFile(tmpPath);
  }

  private async removeTemporaryFile(tmpPath: string) {
    try {
      await fs.unlink(tmpPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private reportFinalizationError(stream: WriteStream, error: unknown) {
    const finalizationError = error instanceof Error ? error : new Error(String(error));
    console.error('Failed to finalize cache write:', finalizationError);
    debug(`Failed to finalize cache write: ${finalizationError.message}`);

    if (stream.listenerCount('error') > 0) {
      try {
        stream.emit('error', finalizationError);
      } catch (reportingError: unknown) {
        const message = reportingError instanceof Error ? reportingError.message : String(reportingError);
        debug(`Cache write error listener failed: ${message}`);
      }
    }
  }

  private reportWriteError(error: unknown) {
    const writeError = error instanceof Error ? error : new Error(String(error));
    console.error('Failed to write cache temporary file:', writeError);
    debug(`Failed to write cache temporary file: ${writeError.message}`);
  }

  private async evictOldest() {
    debug('Evicting oldest files...');

    let totalSizeBytes = await this.getDiskUsageInBytes();
    let numOfEvictedFiles = 0;
    // Continue to evict until we're under the limit
    /* eslint-disable no-await-in-loop */
    while (totalSizeBytes > this.config.CACHE_LIMIT_IN_BYTES) {
      const oldest = await prisma.fileCache.findFirst({
        orderBy: {
          accessedAt: 'asc',
        },

      });

      if (!oldest) {
        throw new Error(`Cache usage is ${totalSizeBytes} bytes, above the configured limit of ${this.config.CACHE_LIMIT_IN_BYTES} bytes, but no indexed file is available to evict`);
      }

      await prisma.fileCache.delete({
        where: {
          hash: oldest.hash,
        },
      });
      await fs.unlink(path.join(this.config.CACHE_DIR, oldest.hash));
      debug(`${oldest.hash} has been evicted`);
      numOfEvictedFiles++;

      totalSizeBytes = await this.getDiskUsageInBytes();
    }
    /* eslint-enable no-await-in-loop */

    if (numOfEvictedFiles > 0) {
      debug(`${numOfEvictedFiles} files have been evicted`);
    } else {
      debug(`No files needed to be evicted. Total size of the cache is currently ${totalSizeBytes} bytes, and the cache limit is ${this.config.CACHE_LIMIT_IN_BYTES} bytes.`);
    }
  }

  private async removeOrphans() {
    const temporaryDirectory = path.join(this.config.CACHE_DIR, 'tmp');

    for await (const dirent of await fs.opendir(temporaryDirectory)) {
      if (dirent.isFile()) {
        debug(`${dirent.name} was abandoned in the cache temporary directory. Removing from disk.`);
        await fs.unlink(path.join(temporaryDirectory, dirent.name));
      }
    }

    // Check filesystem direction (do files exist on the disk but not in the database?)
    for await (const dirent of await fs.opendir(this.config.CACHE_DIR)) {
      if (dirent.isFile()) {
        const model = await prisma.fileCache.findUnique({
          where: {
            hash: dirent.name,
          },
        });

        if (!model) {
          debug(`${dirent.name} was present on disk but was not in the database. Removing from disk.`);
          await fs.unlink(path.join(this.config.CACHE_DIR, dirent.name));
        }
      }
    }

    // Check database direction (do entries exist in the database but not on the disk?)
    for await (const model of this.getFindAllIterable()) {
      const filePath = path.join(this.config.CACHE_DIR, model.hash);

      try {
        await fs.access(filePath);
      } catch {
        debug(`${model.hash} was present in database but was not on disk. Removing from database.`);
        await prisma.fileCache.delete({
          where: {
            hash: model.hash,
          },
        });
      }
    }
  }

  /**
   * Pulls from the database rather than the filesystem,
   * so may be slightly inaccurate.
   * @returns the total size of the cache in bytes
   */
  private async getDiskUsageInBytes() {
    const data = await prisma.fileCache.aggregate({
      _sum: {
        bytes: true,
      },
    });
    const totalSizeBytes = data._sum.bytes ?? 0;

    return totalSizeBytes;
  }

  /**
   * An efficient way to iterate over all rows.
   * @returns an iterable for the result of FileCache.findAll()
   */
  private getFindAllIterable() {
    const limit = 50;
    let previousHash: string | null = null;

    let models: FileCache[] = [];

    const fetchNextBatch = async () => {
      let where;

      if (previousHash !== null) {
        where = {
          hash: {
            gt: previousHash,
          },
        };
      }

      models = await prisma.fileCache.findMany({
        where,
        orderBy: {
          hash: 'asc',
        },
        take: limit,
      });

      if (models.length > 0) {
        previousHash = models[models.length - 1].hash;
      }
    };

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (models.length === 0) {
              await fetchNextBatch();
            }

            if (models.length === 0) {
              // Must return value here for types to be inferred correctly
              return {done: true, value: null as unknown as FileCache};
            }

            return {value: models.shift()!, done: false};
          },
        };
      },
    };
  }
}
