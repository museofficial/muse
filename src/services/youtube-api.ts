import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got from 'got';
import ytsr, {Video} from 'ytsr';
import YouTube, {YoutubePlaylistItem, YoutubeVideo} from 'youtube.ts';
import PQueue from 'p-queue';
import {SongMetadata, QueuedPlaylist, MediaSource} from './player.js';
import {TYPES} from '../types.js';
import {cleanUrl} from '../utils/url.js';
import ThirdParty from './third-party.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import {parseTime} from '../utils/time.js';

interface VideoDetailsResponse {
  id: string;
  contentDetails: {
    videoId: string;
    duration: string;
  };
}

@injectable()
export default class {
  private readonly youtube: YouTube;
  private readonly youtubeKey: string;
  private readonly cache: KeyValueCacheProvider;

  private readonly ytsrQueue: PQueue;

  constructor(
  @inject(TYPES.ThirdParty) thirdParty: ThirdParty,
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.youtube = thirdParty.youtube;
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.cache = cache;

    this.ytsrQueue = new PQueue({concurrency: 4});
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

    return this.getVideo(firstVideo.id, shouldSplitChapters);
  }

  async getVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const video = await this.cache.wrap(
      this.youtube.videos.get,
      cleanUrl(url),
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );

    return this.getMetadataFromVideo({video, shouldSplitChapters});
  }

  async getPlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    // YouTube playlist
    const playlist = await this.cache.wrap(
      this.youtube.playlists.get,
      listId,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    const playlistVideos: YoutubePlaylistItem[] = [];
    const videoDetailsPromises: Array<Promise<void>> = [];
    const videoDetails: VideoDetailsResponse[] = [];

    let nextToken: string | undefined;

    while (playlistVideos.length < playlist.contentDetails.itemCount) {
      // eslint-disable-next-line no-await-in-loop
      const {items, nextPageToken} = await this.cache.wrap(
        this.youtube.playlists.items,
        listId,
        {maxResults: '50', pageToken: nextToken},
        {
          expiresIn: ONE_MINUTE_IN_SECONDS,
        },
      );

      nextToken = nextPageToken;

      playlistVideos.push(...items);

      // Start fetching extra details about videos
      videoDetailsPromises.push((async () => {
        // Unfortunately, package doesn't provide a method for this
        const p = {
          searchParams: {
            part: 'contentDetails',
            id: items.map(item => item.contentDetails.videoId).join(','),
            key: this.youtubeKey,
            responseType: 'json',
          },
        };
        const {items: videoDetailItems} = await this.cache.wrap(
          async () => got(
            'https://www.googleapis.com/youtube/v3/videos',
            p,
          ).json() as Promise<{items: VideoDetailsResponse[]}>,
          p,
          {
            expiresIn: ONE_MINUTE_IN_SECONDS,
          },
        );

        videoDetails.push(...videoDetailItems);
      })());
    }

    await Promise.all(videoDetailsPromises);

    const queuedPlaylist = {title: playlist.snippet.title, source: playlist.id};

    const songsToReturn: SongMetadata[] = [];

    for (const video of playlistVideos) {
      try {
        songsToReturn.push(...this.getMetadataFromVideo({
          video,
          queuedPlaylist,
          videoDetails: videoDetails.find((i: {id: string}) => i.id === video.contentDetails.videoId),
          shouldSplitChapters,
        }));
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  // TODO: we should convert YouTube videos (from both single videos and playlists) to an intermediate representation so we don't have to check if it's from a playlist
  private getMetadataFromVideo({
    video,
    queuedPlaylist,
    videoDetails,
    shouldSplitChapters,
  }: {
    video: YoutubeVideo | YoutubePlaylistItem;
    queuedPlaylist?: QueuedPlaylist;
    videoDetails?: VideoDetailsResponse;
    shouldSplitChapters?: boolean;
  }): SongMetadata[] {
    let url: string;
    let videoDurationSeconds: number;
    // Dirty hack
    if (queuedPlaylist) {
      // Is playlist item
      video = video as YoutubePlaylistItem;
      url = video.contentDetails.videoId;
      videoDurationSeconds = toSeconds(parse(videoDetails!.contentDetails.duration));
    } else {
      video = video as YoutubeVideo;
      videoDurationSeconds = toSeconds(parse(video.contentDetails.duration));
      url = video.id;
    }

    const base: SongMetadata = {
      source: MediaSource.Youtube,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: videoDurationSeconds,
      offset: 0,
      url,
      playlist: queuedPlaylist ?? null,
      isLive: (video as YoutubeVideo).snippet.liveBroadcastContent === 'live',
      thumbnailUrl: video.snippet.thumbnails.medium.url,
    };

    if (!shouldSplitChapters) {
      return [base];
    }

    const chapters = this.parseChaptersFromDescription(video.snippet.description, videoDurationSeconds);

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
}
