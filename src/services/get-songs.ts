import {URL} from 'url';
import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got from 'got';
import ytsr, {Video} from 'ytsr';
import spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import YouTube, {YoutubePlaylistItem} from 'youtube.ts';
import PQueue from 'p-queue';
import shuffle from 'array-shuffle';
import {Except} from 'type-fest';
import {QueuedSong, QueuedPlaylist} from '../services/player.js';
import {TYPES} from '../types.js';
import {cleanUrl} from '../utils/url.js';
import ThirdParty from './third-party.js';
import Config from './config.js';
import CacheProvider from './cache.js';

type QueuedSongWithoutChannel = Except<QueuedSong, 'addedInChannelId'>;

const ONE_HOUR_IN_SECONDS = 60 * 60;
const ONE_MINUTE_IN_SECONDS = 1 * 60;

@injectable()
export default class {
  private readonly youtube: YouTube;
  private readonly youtubeKey: string;
  private readonly spotify: Spotify;
  private readonly cache: CacheProvider;

  private readonly ytsrQueue: PQueue;

  constructor(
  @inject(TYPES.ThirdParty) thirdParty: ThirdParty,
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.Cache) cache: CacheProvider) {
    this.youtube = thirdParty.youtube;
    this.youtubeKey = config.YOUTUBE_API_KEY;
    this.spotify = thirdParty.spotify;
    this.cache = cache;

    this.ytsrQueue = new PQueue({concurrency: 4});
  }

  async youtubeVideoSearch(query: string): Promise<QueuedSongWithoutChannel | null> {
    try {
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

      return await this.youtubeVideo(firstVideo.id);
    } catch (_: unknown) {
      return null;
    }
  }

  async youtubeVideo(url: string): Promise<QueuedSongWithoutChannel | null> {
    try {
      const videoDetails = await this.cache.wrap(
        this.youtube.videos.get,
        cleanUrl(url),
        {
          expiresIn: ONE_HOUR_IN_SECONDS,
        },
      );

      return {
        title: videoDetails.snippet.title,
        artist: videoDetails.snippet.channelTitle,
        length: toSeconds(parse(videoDetails.contentDetails.duration)),
        url: videoDetails.id,
        playlist: null,
        isLive: videoDetails.snippet.liveBroadcastContent === 'live',
      };
    } catch (_: unknown) {
      return null;
    }
  }

  async youtubePlaylist(listId: string): Promise<QueuedSongWithoutChannel[]> {
    // YouTube playlist
    const playlist = await this.cache.wrap(
      this.youtube.playlists.get,
      listId,
      {
        expiresIn: ONE_MINUTE_IN_SECONDS,
      },
    );

    interface VideoDetailsResponse {
      id: string;
      contentDetails: {
        videoId: string;
        duration: string;
      };
    }

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

    const songsToReturn: QueuedSongWithoutChannel[] = [];

    for (const video of playlistVideos) {
      try {
        const length = toSeconds(parse(videoDetails.find((i: {id: string}) => i.id === video.contentDetails.videoId)!.contentDetails.duration));

        songsToReturn.push({
          title: video.snippet.title,
          artist: video.snippet.channelTitle,
          length,
          url: video.contentDetails.videoId,
          playlist: queuedPlaylist,
          isLive: false,
        });
      } catch (_: unknown) {
        // Private and deleted videos are sometimes in playlists, duration of these is not returned and they should not be added to the queue.
      }
    }

    return songsToReturn;
  }

  async spotifySource(url: string): Promise<[QueuedSongWithoutChannel[], number, number]> {
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

    // Get 50 random songs if many
    const originalNSongs = tracks.length;

    if (tracks.length > 50) {
      const shuffled = shuffle(tracks);

      tracks = shuffled.slice(0, 50);
    }

    let songs = await Promise.all(tracks.map(async track => this.spotifyToYouTube(track, playlist)));

    let nSongsNotFound = 0;

    // Get rid of null values
    songs = songs.reduce((accum: QueuedSongWithoutChannel[], song) => {
      if (song) {
        accum.push(song);
      } else {
        nSongsNotFound++;
      }

      return accum;
    }, []);

    return [songs as QueuedSongWithoutChannel[], nSongsNotFound, originalNSongs];
  }

  private async spotifyToYouTube(track: SpotifyApi.TrackObjectSimplified, _: QueuedPlaylist | null): Promise<QueuedSongWithoutChannel | null> {
    try {
      return await this.youtubeVideoSearch(`"${track.name}" "${track.artists[0].name}"`);
    } catch (_: unknown) {
      return null;
    }
  }
}
