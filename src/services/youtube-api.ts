import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got, {Got} from 'got';
import ytsr, {Video} from '@distube/ytsr';
import PQueue from 'p-queue';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import {parseTime} from '../utils/time.js';
import getYouTubeID from 'get-youtube-id';

interface VideoDetailsResponse {
  id: string;
  contentDetails: {
    videoId: string;
    duration: string;
  };
  snippet: {
    title: string;
    channelTitle: string;
    liveBroadcastContent: string;
    description: string;
    thumbnails: {
      medium: {
        url: string;
      };
    };
  };
}

interface PlaylistResponse {
  id: string;
  contentDetails: {
    itemCount: number;
  };
  snippet: {
    title: string;
  };
}

interface PlaylistItemsResponse {
  items: PlaylistItem[];
  nextPageToken?: string;
}

interface PlaylistItem {
  id: string;
  contentDetails: {
    videoId: string;
  };
}

@injectable()
export default class {
  private readonly youtubeKey: string;
  private readonly cache: KeyValueCacheProvider;
  private readonly ytsrQueue: PQueue;
  private readonly got: Got;

  constructor(@inject(TYPES.Config) config: Config, @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.cache = cache;
    this.ytsrQueue = new PQueue({concurrency: 4});

    this.got = got.extend({
      prefixUrl: 'https://www.googleapis.com/youtube/v3/',
      searchParams: {
        key: this.youtubeKey,
        responseType: 'json',
      },
    });
  }

  async search(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const {items} = await this.ytsrQueue.add(async () => this.cache.wrap(
      ytsr,
      query,
      {
        limit: 10,
      },
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    ));

    let firstVideo: Video | undefined;

    for (const item of items) {
      if (item.type === 'video') {
        firstVideo = item;
        break;
      }
    }

    if (!firstVideo) {
      throw new Error('No video found.');
    }

    return this.getVideo(firstVideo.url, shouldSplitChapters);
  }

  async getVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const result = await this.getVideosByID([String(getYouTubeID(url))]);
    const video = result.at(0);

    if (!video) {
      throw new Error('Video could not be found.');
    }

    return this.getMetadataFromVideo({video, shouldSplitChapters});
  }

  async getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const playlistParams = {
      searchParams: {
        part: 'id, snippet, contentDetails',
        id: listId,
      },
    };
    const {items: playlists} = await this.cache.wrap(
      async () => this.got('playlists', playlistParams).json() as Promise<{items: PlaylistResponse[]}>,
      playlistParams,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    const playlist = playlists.at(0)!;

    if (!playlist) {
      throw new Error('Playlist could not be found.');
    }

    const playlistVideos: PlaylistItem[] = [];
    const videoDetailsPromises: Array<Promise<void>> = [];
    const videoDetails: VideoDetailsResponse[] = [];

    let nextToken: string | undefined;

    while (playlistVideos.length < playlist.contentDetails.itemCount) {
      const playlistItemsParams = {
        searchParams: {
          part: 'id, contentDetails',
          playlistId: listId,
          maxResults: '50',
          pageToken: nextToken,
        },
      };

      // eslint-disable-next-line no-await-in-loop
      const {items, nextPageToken} = await this.cache.wrap(
        async () => this.got('playlistItems', playlistItemsParams).json() as Promise<PlaylistItemsResponse>,
        playlistItemsParams,
        {
          expiresIn: ONE_MINUTE_IN_SECONDS,
        },
      );

      nextToken = nextPageToken;
      playlistVideos.push(...items);

      // Start fetching extra details about videos
      // PlaylistItem misses some details, eg. if the video is a livestream
      videoDetailsPromises.push((async () => {
        const videoDetailItems = await this.getVideosByID(items.map(item => item.contentDetails.videoId));
        videoDetails.push(...videoDetailItems);
      })());
    }

    await Promise.all(videoDetailsPromises);

    const queuedPlaylist = {title: playlist.snippet.title, source: playlist.id};

    const songsToReturn: SongMetadata[] = [];

    for (const video of playlistVideos) {
      try {
        songsToReturn.push(...this.getMetadataFromVideo({
          video: videoDetails.find((i: {id: string}) => i.id === video.contentDetails.videoId)!,
          queuedPlaylist,
          shouldSplitChapters,
        }));
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these
        // is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  private getMetadataFromVideo({
    video,
    queuedPlaylist,
    shouldSplitChapters,
  }: {
    video: VideoDetailsResponse; // | YoutubePlaylistItem;
    queuedPlaylist?: QueuedPlaylist;
    shouldSplitChapters?: boolean;
  }): SongMetadata[] {
    const base: SongMetadata = {
      source: MediaSource.Youtube,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: toSeconds(parse(video.contentDetails.duration)),
      offset: 0,
      url: video.id,
      playlist: queuedPlaylist ?? null,
      isLive: video.snippet.liveBroadcastContent === 'live',
      thumbnailUrl: video.snippet.thumbnails.medium.url,
    };

    if (!shouldSplitChapters) {
      return [base];
    }

    const chapters = this.parseChaptersFromDescription(video.snippet.description, base.length);

    if (!chapters) {
      return [base];
    }

    const tracks: SongMetadata[] = [];

    for (const [label, {offset, length}] of chapters) {
      tracks.push({
        ...base,
        offset,
        length,
        title: `${label} (${base.title})`,
      });
    }

    return tracks;
  }

  private parseChaptersFromDescription(description: string, videoDurationSeconds: number) {
    const map = new Map<string, {offset: number; length: number}>();
    let foundFirstTimestamp = false;

    const foundTimestamps: Array<{name: string; offset: number}> = [];
    for (const line of description.split('\n')) {
      const timestamps = Array.from(line.matchAll(/(?:\d+:)+\d+/g));
      if (timestamps?.length !== 1) {
        continue;
      }

      if (!foundFirstTimestamp) {
        if (/0{1,2}:00/.test(timestamps[0][0])) {
          foundFirstTimestamp = true;
        } else {
          continue;
        }
      }

      const timestamp = timestamps[0][0];
      const seconds = parseTime(timestamp);
      const chapterName = line.split(timestamp)[1].trim();

      foundTimestamps.push({name: chapterName, offset: seconds});
    }

    for (const [i, {name, offset}] of foundTimestamps.entries()) {
      map.set(name, {
        offset,
        length: i === foundTimestamps.length - 1
          ? videoDurationSeconds - offset
          : foundTimestamps[i + 1].offset - offset,
      });
    }

    if (!map.size) {
      return null;
    }

    return map;
  }

  private async getVideosByID(videoIDs: string[]): Promise<VideoDetailsResponse[]> {
    const p = {
      searchParams: {
        part: 'id, snippet, contentDetails',
        id: videoIDs.join(','),
      },
    };

    const {items: videos} = await this.cache.wrap(
      async () => this.got('videos', p).json() as Promise<{items: VideoDetailsResponse[]}>,
      p,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );
    return videos;
  }
}
