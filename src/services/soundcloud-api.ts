import {inject, injectable} from 'inversify';
import PQueue from 'p-queue';
import Soundcloud, {SoundcloudTrackV2} from 'soundcloud.ts';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import ThirdParty from './third-party.js';

@injectable()
export default class {
  private readonly cache: KeyValueCacheProvider;
  private readonly soundcloud: Soundcloud;
  private readonly scsrQueue: PQueue;

  constructor(@inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider, @inject(TYPES.ThirdParty) thirdParty: ThirdParty) {
    this.soundcloud = thirdParty.soundcloud;
    this.cache = cache;
    this.scsrQueue = new PQueue({concurrency: 4});
  }

  async search(query: string): Promise<SongMetadata[]> {
    const items = await this.scsrQueue.add(async () => this.cache.wrap(
      async () => this.soundcloud.tracks.searchV2({q: query}),
      {
        key: 'scsearch:' + query,
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    ));

    const track = items.collection.at(0);

    if (!track) {
      throw new Error('Track could not be found.');
    }

    return this.getMetadataFromVideo({track});
  }

  async get(query: string): Promise<SongMetadata[]> {
    const track = await this.scsrQueue.add(async () => this.cache.wrap(
      async () => this.soundcloud.tracks.getV2(query),
      {
        key: 'scget:' + query,
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    ));

    if (!track) {
      throw new Error('Track could not be found.');
    }

    return this.getMetadataFromVideo({track});
  }

  async getPlaylist(query: string): Promise<SongMetadata[]> {
    const playlist = await this.cache.wrap(
      async () => this.soundcloud.playlists.getV2(query),
      {
        key: 'scplaylist:' + query,
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    if (!playlist) {
      throw new Error('Playlist could not be found.');
    }

    const queuedPlaylist = {title: playlist.title, source: playlist.id.toString()};

    const songsToReturn: SongMetadata[] = [];

    for (const track of playlist.tracks) {
      try {
        songsToReturn.push(...this.getMetadataFromVideo({
          track,
          queuedPlaylist,
        }));
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these
        // is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  // Not fully supported yet.
  async getArtist(userName: string): Promise<SongMetadata[]> {
    const tracks = await this.cache.wrap(
      async () => this.soundcloud.users.tracksV2(userName),
      {
        key: userName + 'tracks',
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    const user = await this.cache.wrap(
      async () => this.soundcloud.users.getV2(userName),
      {
        key: userName + 'user',
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    if (!tracks) {
      throw new Error('Playlist could not be found.');
    }

    const queuedPlaylist = {title: user.username, source: user.id.toString()};

    const songsToReturn: SongMetadata[] = [];

    for (const track of tracks) {
      try {
        songsToReturn.push(...this.getMetadataFromVideo({
          track,
          queuedPlaylist,
        }));
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these
        // is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  private getMetadataFromVideo({
    track,
    queuedPlaylist,
  }: {
    track: SoundcloudTrackV2;
    queuedPlaylist?: QueuedPlaylist;
  }): SongMetadata[] {
    const base: SongMetadata = {
      source: MediaSource.SoundCloud,
      title: track.title,
      artist: track.user.username,
      length: track.duration / 1000,
      offset: 0,
      url: track.permalink_url,
      playlist: queuedPlaylist ?? null,
      isLive: false,
      thumbnailUrl: track.artwork_url,
    };

    return [base];
  }
}
