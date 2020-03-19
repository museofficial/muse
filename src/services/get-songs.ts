import {URL} from 'url';
import {inject, injectable} from 'inversify';
import {toSeconds, parse} from 'iso8601-duration';
import got from 'got';
import spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import ytsr from 'ytsr';
import YouTube from 'youtube.ts';
import pLimit from 'p-limit';
import uniqueRandomArray from 'unique-random-array';
import {QueuedSong, QueuedPlaylist} from '../services/queue';
import {TYPES} from '../types';

@injectable()
export default class {
  private readonly youtube: YouTube;
  private readonly youtubeKey: string;
  private readonly spotify: Spotify;

  constructor(@inject(TYPES.Lib.YouTube) youtube: YouTube, @inject(TYPES.Config.YOUTUBE_API_KEY) youtubeKey: string, @inject(TYPES.Lib.Spotify) spotify: Spotify) {
    this.youtube = youtube;
    this.youtubeKey = youtubeKey;
    this.spotify = spotify;
  }

  async youtubeVideoSearch(query: string): Promise<QueuedSong|null> {
    try {
      const {items: [video]} = await this.youtube.videos.search({q: query, maxResults: 1, type: 'video'});

      return await this.youtubeVideo(video.id.videoId);
    } catch (_) {
      return null;
    }
  }

  async youtubeVideo(url: string): Promise<QueuedSong|null> {
    try {
      const videoDetails = await this.youtube.videos.get(url);

      return {
        title: videoDetails.snippet.title,
        artist: videoDetails.snippet.channelTitle,
        length: toSeconds(parse(videoDetails.contentDetails.duration)),
        url: videoDetails.id,
        playlist: null,
        isLive: videoDetails.snippet.liveBroadcastContent === 'live'
      };
    } catch (_) {
      return null;
    }
  }

  async youtubePlaylist(listId: string): Promise<QueuedSong[]> {
    // YouTube playlist
    const playlist = await this.youtube.playlists.get(listId);
    const {items} = await this.youtube.playlists.items(listId, {maxResults: '50'});

    // Unfortunately, package doesn't provide a method for this
    const res: any = await got('https://www.googleapis.com/youtube/v3/videos', {searchParams: {
      part: 'contentDetails',
      id: items.map(item => item.contentDetails.videoId).join(','),
      key: this.youtubeKey
    }}).json();

    const queuedPlaylist = {title: playlist.snippet.title, source: playlist.id};

    return items.map(video => {
      const length = toSeconds(parse(res.items.find((i: any) => i.id === video.contentDetails.videoId).contentDetails.duration));

      return {
        title: video.snippet.title,
        artist: video.snippet.channelTitle,
        length,
        url: video.contentDetails.videoId,
        playlist: queuedPlaylist,
        isLive: false
      };
    });
  }

  async spotifySource(url: string): Promise<[QueuedSong[], number, number]> {
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

        let [{body: playlistResponse}, {body: tracksResponse}] = await Promise.all([this.spotify.getPlaylist(uri.id), this.spotify.getPlaylistTracks(uri.id, {limit: 1})]);

        playlist = {title: playlistResponse.name, source: playlistResponse.href};

        tracks.push(...tracksResponse.items.map(playlistItem => playlistItem.track));

        while (tracksResponse.next) {
          // eslint-disable-next-line no-await-in-loop
          ({body: tracksResponse} = await this.spotify.getPlaylistTracks(uri.id, {
            limit: parseInt(new URL(tracksResponse.next).searchParams.get('limit') ?? '1', 10),
            offset: parseInt(new URL(tracksResponse.next).searchParams.get('offset') ?? '0', 10)
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
      const random = uniqueRandomArray(tracks);

      tracks = [];
      for (let i = 0; i < 50; i++) {
        tracks.push(random());
      }
    }

    // Limit concurrency so hopefully we don't get banned for searching
    const limit = pLimit(5);
    let songs = await Promise.all(tracks.map(async track => limit(async () => this.spotifyToYouTube(track, playlist))));

    let nSongsNotFound = 0;

    // Get rid of null values
    songs = songs.reduce((accum: QueuedSong[], song) => {
      if (song) {
        accum.push(song);
      } else {
        nSongsNotFound++;
      }

      return accum;
    }, []);

    return [songs as QueuedSong[], nSongsNotFound, originalNSongs];
  }

  private async spotifyToYouTube(track: SpotifyApi.TrackObjectSimplified, playlist: QueuedPlaylist | null): Promise<QueuedSong | null> {
    try {
      const {items} = await ytsr(`${track.name} ${track.artists[0].name} offical`, {limit: 5});
      const video = items.find((item: { type: string }) => item.type === 'video');

      if (!video) {
        throw new Error('No video found for query.');
      }

      return {
        title: video.title,
        artist: track.artists[0].name,
        length: track.duration_ms / 1000,
        url: video.link,
        playlist,
        isLive: video.live
      };
    } catch (_) {
      return null;
    }
  }
}
