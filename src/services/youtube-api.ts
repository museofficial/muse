import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got, {Got, HTTPError} from 'got';
import ytsr, {Video} from '@distube/ytsr';
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import {parseTime} from '../utils/time.js';
import getYouTubeID from 'get-youtube-id';
import debug from '../utils/debug.js';

// Define possible error types for better error handling and type safety
interface YouTubeError extends Error {
  code: 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN';
  status?: number;
  retryable: boolean;
}

// Configuration constants for API interaction and reliability
const YOUTUBE_MAX_RETRY_COUNT = 3;
const YOUTUBE_BASE_RETRY_DELAY_MS = 1000;
const YOUTUBE_SEARCH_CONCURRENCY = 4;
const MAX_CACHE_KEY_LENGTH = 250;  // Prevent extremely long cache keys

// Response type definitions
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
    this.ytsrQueue = new PQueue({concurrency: YOUTUBE_SEARCH_CONCURRENCY});

    this.got = got.extend({
      prefixUrl: 'https://www.googleapis.com/youtube/v3/',
      searchParams: {
        key: this.youtubeKey,
        responseType: 'json',
      },
    });
  }

  private createYouTubeError(message: string, code: YouTubeError['code'], status?: number): YouTubeError {
    const error = new Error(message) as YouTubeError;
    error.code = code;
    error.status = status;
    // Network errors and 5xx are retryable, most 4xx are not
    error.retryable = code === 'NETWORK_ERROR' || (status ? status >= 500 : false);
    return error;
  }

  private createCacheKey(prefix: string, key: string): string {
    // Ensure cache keys don't exceed maximum length while remaining unique
    const fullKey = `${prefix}-${key}`;
    if (fullKey.length <= MAX_CACHE_KEY_LENGTH) {
      return fullKey;
    }
    return `${prefix}-${key.slice(0, MAX_CACHE_KEY_LENGTH - prefix.length - 41)}-${require('crypto').createHash('sha1').update(key).digest('hex')}`;
  }

  private async executeYouTubeRequest<T>(endpoint: string, params: any): Promise<T> {
    return pRetry(
      async () => {
        try {
          const response = await this.got(endpoint, params).json() as T;
          
          if (!response) {
            throw this.createYouTubeError(
              'Empty response from YouTube API',
              'NETWORK_ERROR'
            );
          }
          
          return response;
        } catch (error) {
          if (error instanceof HTTPError) {
            const status = error.response.statusCode;
            
            switch (status) {
              case 403:
                throw this.createYouTubeError(
                  'YouTube API quota exceeded. Please try again later.',
                  'QUOTA_EXCEEDED',
                  status
                );
              case 429:
                throw this.createYouTubeError(
                  'YouTube API rate limit reached. Please try again later.',
                  'RATE_LIMITED',
                  status
                );
              case 404:
                throw this.createYouTubeError(
                  'Resource not found on YouTube.',
                  'NOT_FOUND',
                  status
                );
              default:
                if (status >= 500) {
                  throw this.createYouTubeError(
                    'YouTube API is temporarily unavailable.',
                    'NETWORK_ERROR',
                    status
                  );
                }
                throw this.createYouTubeError(
                  'YouTube API request failed.',
                  'UNKNOWN',
                  status
                );
            }
          }

          if (error instanceof got.TimeoutError) {
            throw this.createYouTubeError(
              'YouTube API request timed out.',
              'NETWORK_ERROR'
            );
          }

          throw error;
        }
      },
      {
        retries: YOUTUBE_MAX_RETRY_COUNT,
        minTimeout: ({attemptNumber}) => {
          const delay = YOUTUBE_BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber - 1);
          const jitter = Math.random() * 200;
          return delay + jitter;
        },
        onFailedAttempt: error => {
          const youTubeError = error instanceof Error && 'code' in error
            ? error as YouTubeError
            : null;

          debug(
            `YouTube API request failed (attempt ${error.attemptNumber}/${YOUTUBE_MAX_RETRY_COUNT + 1})\n` +
            `Error code: ${youTubeError?.code ?? 'UNKNOWN'}\n` +
            `Status: ${youTubeError?.status ?? 'N/A'}\n` +
            `Message: ${error.message}\n` +
            `Retries left: ${error.retriesLeft}`
          );

          if (youTubeError && !youTubeError.retryable) {
            throw new pRetry.AbortError(error.message);
          }
        },
      }
    );
  }

  async search(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    try {
      const {items} = await this.ytsrQueue.add(async () => this.cache.wrap(
        ytsr,
        query,
        {
          limit: 10,
        },
        {
          expiresIn: ONE_HOUR_IN_SECONDS,
          key: this.createCacheKey('youtube-search', query),
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
        throw new Error('No matching videos found.');
      }

      return this.getVideo(firstVideo.url, shouldSplitChapters);
    } catch (error) {
      debug('YouTube search error:', error);
      throw new Error('Failed to search YouTube. Please try again.');
    }
  }

  async getVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const videoId = getYouTubeID(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL.');
    }

    const result = await this.getVideosByID([videoId]);
    const video = result.at(0);

    if (!video) {
      throw new Error('Video could not be found or is unavailable.');
    }

    return this.getMetadataFromVideo({video, shouldSplitChapters});
  }

  async getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    try {
      const playlistParams = {
        searchParams: {
          part: 'id, snippet, contentDetails',
          id: listId,
        },
      };
      
      const {items: playlists} = await this.cache.wrap(
        async () => this.executeYouTubeRequest<{items: PlaylistResponse[]}>('playlists', playlistParams),
        playlistParams,
        {
          expiresIn: ONE_MINUTE_IN_SECONDS,
          key: this.createCacheKey('youtube-playlist', listId),
        },
      );

      const playlist = playlists.at(0);
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

        const {items, nextPageToken} = await this.cache.wrap(
          async () => this.executeYouTubeRequest<PlaylistItemsResponse>('playlistItems', playlistItemsParams),
          playlistItemsParams,
          {
            expiresIn: ONE_MINUTE_IN_SECONDS,
            key: this.createCacheKey('youtube-playlist-items', `${listId}-${nextToken ?? 'initial'}`),
          },
        );

        nextToken = nextPageToken;
        playlistVideos.push(...items);

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
          const videoDetail = videoDetails.find(i => i.id === video.contentDetails.videoId);
          if (videoDetail) {
            songsToReturn.push(...this.getMetadataFromVideo({
              video: videoDetail,
              queuedPlaylist,
              shouldSplitChapters,
            }));
          }
        } catch (error) {
          debug(`Skipping unavailable video in playlist: ${video.contentDetails.videoId}`);
          // Continue with next video
        }
      }

      if (songsToReturn.length === 0) {
        throw new Error('No playable videos found in this playlist.');
      }

      return songsToReturn;
    } catch (error) {
      debug('Playlist processing error:', error);
      if (error instanceof Error) {
        throw error;  // Preserve user-friendly error messages
      }
      throw new Error('Failed to process playlist. Please try again.');
    }
  }

  private async getVideosByID(videoIDs: string[]): Promise<VideoDetailsResponse[]> {
    if (videoIDs.length === 0) {
      return [];
    }

    const params = {
      searchParams: {
        part: 'id, snippet, contentDetails',
        id: videoIDs.join(','),
      },
    };

    try {
      const {items: videos} = await this.cache.wrap(
        async () => this.executeYouTubeRequest<{items: VideoDetailsResponse[]}>('videos', params),
        params,
        {
          expiresIn: ONE_HOUR_IN_SECONDS,
          key: this.createCacheKey('youtube-videos', videoIDs.join(',')),
        },
      );
      return videos;
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const youTubeError = error as YouTubeError;
        if (youTubeError.code === 'QUOTA_EXCEEDED' || youTubeError.code === 'RATE_LIMITED') {
          throw error;
        }
      }
      throw new Error('Failed to fetch video information. Please try again.');
    }
  }

  private getMetadataFromVideo({
    video,
    queuedPlaylist,
    shouldSplitChapters,
  }: {
    video: VideoDetailsResponse;
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

    return Array.from(chapters.entries()).map(([label, {offset, length}]) => ({
      ...base,
      offset,
      length,
      title: `${label} (${base.title})`,
    }));
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

    return map.size > 0 ? map : null;
  }
}