import {URL} from 'url';
import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';
import shuffle from 'array-shuffle';
import {QueuedPlaylist} from './player.js';

export interface SpotifyTrack {
  name: string;
  artist: string;
}

@injectable()
export default class {
  private readonly spotify: Spotify;

  constructor(@inject(TYPES.ThirdParty) thirdParty: ThirdParty) {
    this.spotify = thirdParty.spotify;
  }

  async getAlbum(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Album;
    const [{body: album}, {body: {items}}] = await Promise.all([this.spotify.getAlbum(uri.id), this.spotify.getAlbumTracks(uri.id, {limit: 50})]);
    const tracks = this.limitTracks(items, playlistLimit).map(this.toSpotifyTrack);
    const playlist = {title: album.name, source: album.href};

    return [tracks, playlist];
  }

  async getPlaylist(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Playlist;

    let [{body: playlistResponse}, {body: tracksResponse}] = await Promise.all([this.spotify.getPlaylist(uri.id), this.spotify.getPlaylistTracks(uri.id, {limit: 50})]);

    const items = tracksResponse.items.map(playlistItem => playlistItem.track);
    const playlist = {title: playlistResponse.name, source: playlistResponse.href};

    while (tracksResponse.next) {
      // eslint-disable-next-line no-await-in-loop
      ({body: tracksResponse} = await this.spotify.getPlaylistTracks(uri.id, {
        limit: parseInt(new URL(tracksResponse.next).searchParams.get('limit') ?? '50', 10),
        offset: parseInt(new URL(tracksResponse.next).searchParams.get('offset') ?? '0', 10),
      }));

      items.push(...tracksResponse.items.map(playlistItem => playlistItem.track));
    }

    const tracks = this.limitTracks(items.filter(i => i !== null) as SpotifyApi.TrackObjectSimplified[], playlistLimit).map(this.toSpotifyTrack);

    return [tracks, playlist];
  }

  async getTrack(url: string): Promise<SpotifyTrack> {
    const uri = spotifyURI.parse(url) as spotifyURI.Track;
    const {body} = await this.spotify.getTrack(uri.id);

    return this.toSpotifyTrack(body);
  }

  async getArtist(url: string, playlistLimit: number): Promise<SpotifyTrack[]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Artist;
    const {body} = await this.spotify.getArtistTopTracks(uri.id, 'US');

    return this.limitTracks(body.tracks, playlistLimit).map(this.toSpotifyTrack);
  }

  private toSpotifyTrack(track: SpotifyApi.TrackObjectSimplified): SpotifyTrack {
    return {
      name: track.name,
      artist: track.artists[0].name,
    };
  }

  private limitTracks(tracks: SpotifyApi.TrackObjectSimplified[], limit: number) {
    return tracks.length > limit ? shuffle(tracks).slice(0, limit) : tracks;
  }
}
