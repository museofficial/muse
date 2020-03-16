import {TextChannel, Message} from 'discord.js';
import YouTube from 'youtube.ts';
import Spotify from 'spotify-web-api-node';
import {URL} from 'url';
import ytsr from 'ytsr';
import pLimit from 'p-limit';
import spotifyURI from 'spotify-uri';
import got from 'got';
import {parse, toSeconds} from 'iso8601-duration';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import {QueuedSong, QueuedPlaylist} from '../services/queue';
import {STATUS} from '../services/player';
import QueueManager from '../managers/queue';
import PlayerManager from '../managers/player';
import {getMostPopularVoiceChannel} from '../utils/channels';
import LoadingMessage from '../utils/loading-message';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'play';
  public description = 'plays a song';
  private readonly queueManager: QueueManager;
  private readonly playerManager: PlayerManager;
  private readonly youtube: YouTube;
  private readonly youtubeKey: string;
  private readonly spotify: Spotify;

  constructor(@inject(TYPES.Managers.Queue) queueManager: QueueManager, @inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Lib.YouTube) youtube: YouTube, @inject(TYPES.Config.YOUTUBE_API_KEY) youtubeKey: string, @inject(TYPES.Lib.Spotify) spotify: Spotify) {
    this.queueManager = queueManager;
    this.playerManager = playerManager;
    this.youtube = youtube;
    this.youtubeKey = youtubeKey;
    this.spotify = spotify;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const queue = this.queueManager.get(msg.guild!.id);

    if (args.length === 0) {
      if (this.playerManager.get(msg.guild!.id).status === STATUS.PLAYING) {
        await msg.channel.send('error: already playing, give me a song name');
        return;
      }

      // Must be resuming play
      if (queue.get().length === 0) {
        await msg.channel.send('error: nothing to play');
        return;
      }

      const channel = getMostPopularVoiceChannel(msg.guild!);

      await this.playerManager.get(msg.guild!.id).connect(channel);
      await this.playerManager.get(msg.guild!.id).play();

      await msg.channel.send('play resuming');
      return;
    }

    const newSongs: QueuedSong[] = [];

    const res = new LoadingMessage(msg.channel as TextChannel, 'hold on a sec');
    await res.start();

    const addSingleSong = async (source: string): Promise<void> => {
      const videoDetails = await this.youtube.videos.get(source);

      newSongs.push({
        title: videoDetails.snippet.title,
        artist: videoDetails.snippet.channelTitle,
        length: toSeconds(parse(videoDetails.contentDetails.duration)),
        url: videoDetails.id,
        playlist: null,
        isLive: videoDetails.snippet.liveBroadcastContent === 'live'
      });
    };

    // Test if it's a complete URL
    try {
      const url = new URL(args[0]);

      const YOUTUBE_HOSTS = ['www.youtube.com', 'youtu.be', 'youtube.com'];

      if (YOUTUBE_HOSTS.includes(url.host)) {
        // YouTube source
        if (url.searchParams.get('list')) {
          // YouTube playlist
          const playlist = await this.youtube.playlists.get(url.searchParams.get('list') as string);
          const {items} = await this.youtube.playlists.items(url.searchParams.get('list') as string, {maxResults: '50'});

          // Unfortunately, package doesn't provide a method for this
          const res: any = await got('https://www.googleapis.com/youtube/v3/videos', {searchParams: {
            part: 'contentDetails',
            id: items.map(item => item.contentDetails.videoId).join(','),
            key: this.youtubeKey
          }}).json();

          const queuedPlaylist = {title: playlist.snippet.title, source: playlist.id};

          items.forEach(video => {
            const length = toSeconds(parse(res.items.find((i: any) => i.id === video.contentDetails.videoId).contentDetails.duration));

            newSongs.push({
              title: video.snippet.title,
              artist: video.snippet.channelTitle,
              length,
              url: video.contentDetails.videoId,
              playlist: queuedPlaylist,
              isLive: false
            });
          });
        } else {
          // Single video
          try {
            await addSingleSong(url.href);
          } catch (error) {
            await res.stop('that doesn\'t exist');
            return;
          }
        }
      } else if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
        // Spotify source
        const parsed = spotifyURI.parse(args[0]);

        const tracks: SpotifyApi.TrackObjectSimplified[] = [];

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
            await res.stop('ope, can\'t add a whole artist');
            return;
          }

          default: {
            await res.stop('huh?');
            return;
          }
        }

        // Search YouTube for each track
        const searchForTrack = async (track: SpotifyApi.TrackObjectSimplified): Promise<QueuedSong|null> => {
          try {
            const {items: [video]} = await ytsr(`${track.name} ${track.artists[0].name} offical`, {limit: 1});

            return {
              title: video.title,
              artist: track.artists[0].name,
              length: track.duration_ms / 1000,
              url: video.link,
              playlist,
              isLive: video.live
            };
          } catch (_) {
            // TODO: handle error
            return null;
          }
        };

        // Limit concurrency so hopefully we don't get banned
        const limit = pLimit(3);
        let songs = await Promise.all(tracks.map(async track => limit(async () => searchForTrack(track))));

        // Get rid of null values
        songs = songs.reduce((accum: QueuedSong[], song) => {
          if (song) {
            accum.push(song);
          }

          return accum;
        }, []);

        newSongs.push(...(songs as QueuedSong[]));
      }
    } catch (_) {
      // Not a URL, must search YouTube
      const query = args.join(' ');

      try {
        const {items: [video]} = await this.youtube.videos.search({q: query, maxResults: 1, type: 'video'});

        await addSingleSong(video.id.videoId);
      } catch (_) {
        await res.stop('that doesn\'t exist');
        return;
      }
    }

    if (newSongs.length === 0) {
      // TODO: better response
      await res.stop('huh?');
      return;
    }

    newSongs.forEach(song => this.queueManager.get(msg.guild!.id).add(song));

    // TODO: better response
    await res.stop('song(s) queued');

    if (this.playerManager.get(msg.guild!.id).status === STATUS.DISCONNECTED) {
      const channel = getMostPopularVoiceChannel(msg.guild!);

      await this.playerManager.get(msg.guild!.id).connect(channel);

      await this.playerManager.get(msg.guild!.id).play();
    }
  }
}
