import {URL} from 'url';
import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got from 'got';
import ytsr, {Video} from 'ytsr';
import spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import YouTube, {YoutubePlaylistItem, YoutubeVideo} from 'youtube.ts';
import PQueue from 'p-queue';
import shuffle from 'array-shuffle';
import {Except} from 'type-fest';
import {QueuedSong, QueuedPlaylist} from '../services/player.js';
import {TYPES} from '../types.js';
import {cleanUrl} from '../utils/url.js';
import ThirdParty from './third-party.js';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS, ONE_MINUTE_IN_SECONDS} from '../utils/constants.js';
import {parseTime} from '../utils/time.js';

type SongMetadata = Except<QueuedSong, 'addedInChannelId' | 'requestedBy'>;

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
  private readonly spotify: Spotify;
  private readonly cache: KeyValueCacheProvider;

  private readonly ytsrQueue: PQueue;

  constructor(
  @inject(TYPES.ThirdParty) thirdParty: ThirdParty,
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.youtube = thirdParty.youtube;
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.spotify = thirdParty.spotify;
    this.cache = cache;

    this.ytsrQueue = new PQueue({concurrency: 4});
  }

  async youtubeVideoSearch(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
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

    return this.youtubeVideo(firstVideo.id, shouldSplitChapters);
  }

  async youtubeVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    const video = await this.cache.wrap(
      this.youtube.videos.get,
      cleanUrl(url),
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
      },
    );

    return this.getMetadataFromVideo({video, shouldSplitChapters});
  }

  async youtubePlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
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

    while (playlistVideos.length !== playlist.contentDetails.itemCount) {
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

  async spotifySource(url: string, playlistLimit: number, shouldSplitChapters: boolean): Promise<[SongMetadata[], number, number]> {
    const parsed = spotifyURI.parse(url);

    let tracks: SpotifyApi.TrackObjectSimplified[] = [];

    let playlist: QueuedPlaylist | null = null;

    switch (parsed.type) {
      case 'album': {
        const uri = parsed as spotifyURI.Album;

        const [{body: album}, {body: {items}}] = await Promise.all([this.spotify.getAlbum(uri.id), this.spotify.getAlbumTracks(uri.id, {limit: 50})]);

        tracks.push(...items);

        playlist = {title: album.name, source: album.href};
        break;
      }

      case 'playlist': {
        const uri = parsed as spotifyURI.Playlist;

        let [{body: playlistResponse}, {body: tracksResponse}] = await Promise.all([this.spotify.getPlaylist(uri.id), this.spotify.getPlaylistTracks(uri.id, {limit: 50})]);

        playlist = {title: playlistResponse.name, source: playlistResponse.href};

        tracks.push(...tracksResponse.items.map(playlistItem => playlistItem.track));

        while (tracksResponse.next) {
          // eslint-disable-next-line no-await-in-loop
          ({body: tracksResponse} = await this.spotify.getPlaylistTracks(uri.id, {
            limit: parseInt(new URL(tracksResponse.next).searchParams.get('limit') ?? '50', 10),
            offset: parseInt(new URL(tracksResponse.next).searchParams.get('offset') ?? '0', 10),
          }));

          tracks.push(...tracksResponse.items.map(playlistItem => playlistItem.track));
        }

        break;
      }

      case 'track': {
        const uri = parsed as spotifyURI.Track;

        const {body} = await this.spotify.getTrack(uri.id);

        tracks.push(body);
        break;
      }

      case 'artist': {
        const uri = parsed as spotifyURI.Artist;

        const {body} = await this.spotify.getArtistTopTracks(uri.id, 'US');

        tracks.push(...body.tracks);
        break;
      }

      default: {
        return [[], 0, 0];
      }
    }

    // Get random songs if the playlist is larger than limit
    const originalNSongs = tracks.length;

    if (tracks.length > playlistLimit) {
      const shuffled = shuffle(tracks);

      tracks = shuffled.slice(0, playlistLimit);
    }

    const searchResults = await Promise.allSettled(tracks.map(async track => this.spotifyToYouTube(track, shouldSplitChapters)));

    let nSongsNotFound = 0;

    // Count songs that couldn't be found
    const songs: SongMetadata[] = searchResults.reduce((accum: SongMetadata[], result) => {
      if (result.status === 'fulfilled') {
        for (const v of result.value) {
          accum.push({
            ...v,
            ...(playlist ? {playlist} : {}),
          });
        }
      } else {
        nSongsNotFound++;
      }

      return accum;
    }, []);

    return [songs, nSongsNotFound, originalNSongs];
  }

  private async spotifyToYouTube(track: SpotifyApi.TrackObjectSimplified, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeVideoSearch(`"${track.name}" "${track.artists[0].name}"`, shouldSplitChapters);
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

    const chapters = this.parseChaptersFromDescription(video.snippet.description, videoDurationSeconds);

    const base: SongMetadata = {
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      length: videoDurationSeconds,
      offset: 0,
      url,
      playlist: queuedPlaylist ?? null,
      isLive: false,
      thumbnailUrl: video.snippet.thumbnails.medium.url,
    };

    if (!chapters || !shouldSplitChapters) {
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
