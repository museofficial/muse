import {promises as fs, createWriteStream} from 'fs';
import path from 'path';
import {inject, injectable} from 'inversify';
import sequelize from 'sequelize';
import {FileCache} from '../models/index.js';
import {TYPES} from '../types.js';
import Config from './config.js';

@injectable()
export default class FileCacheProvider {
  private readonly config: Config;

  constructor(@inject(TYPES.Config) config: Config) {
    this.config = config;
  }

  /**
   * Returns path to cached file if it exists, otherwise throws an error.
   * Updates the `accessedAt` property of the cached file.
   * @param hash lookup key
   */
  async getPathFor(hash: string): Promise<string> {
    const model = await FileCache.findByPk(hash);

    if (!model) {
      throw new Error('File is not cached');
    }

    const resolvedPath = path.join(this.config.CACHE_DIR, hash);

    try {
      await fs.access(resolvedPath);
    } catch (_: unknown) {
      await FileCache.destroy({where: {hash}});

      throw new Error('File is not cached');
    }

    await model.update({accessedAt: new Date()});

    return resolvedPath;
  }

  /**
   * Returns a write stream for the given hash key.
   * The stream handles saving a new file and will
   * update the database after the stream is closed.
   * @param hash lookup key
   */
  createWriteStream(hash: string) {
    const tmpPath = path.join(this.config.CACHE_DIR, 'tmp', hash);
    const finalPath = path.join(this.config.CACHE_DIR, hash);

    const stream = createWriteStream(tmpPath);

    stream.on('close', async () => {
      // Only move if size is non-zero (may have errored out)
      const stats = await fs.stat(tmpPath);

      if (stats.size !== 0) {
        await fs.rename(tmpPath, finalPath);
      }

      await FileCache.create({hash, bytes: stats.size, accessedAt: new Date()});

      await this.evictOldestIfNecessary();
    });

    return stream;
  }

  /**
   * Deletes orphaned cache files and evicts files if
   * necessary. Should be run on program startup so files
   * will be evicted if the cache limit has changed.
   */
  async cleanup() {
    await this.removeOrphans();
    await this.evictOldestIfNecessary();
  }

  private async evictOldestIfNecessary() {
    const [{dataValues: {totalSizeBytes}}] = await FileCache.findAll({
      attributes: [
        [sequelize.fn('sum', sequelize.col('bytes')), 'totalSizeBytes'],
      ],
    }) as unknown as [{dataValues: {totalSizeBytes: number}}];

    if (totalSizeBytes > this.config.CACHE_LIMIT_IN_BYTES) {
      const oldest = await FileCache.findOne({
        order: [
          ['accessedAt', 'ASC'],
        ],
      });

      if (oldest) {
        await oldest.destroy();
        await fs.unlink(path.join(this.config.CACHE_DIR, oldest.hash));
      }

      // Continue to evict until we're under the limit
      await this.evictOldestIfNecessary();
    }
  }

  private async removeOrphans() {
    for await (const dirent of await fs.opendir(this.config.CACHE_DIR)) {
      if (dirent.isFile()) {
        const model = await FileCache.findByPk(dirent.name);

        if (!model) {
          await fs.unlink(path.join(this.config.CACHE_DIR, dirent.name));
        }
      }
    }
  }
}
