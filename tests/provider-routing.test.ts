import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  ffprobe: vi.fn(),
  shuffle: vi.fn((tracks: unknown[]) => tracks),
  getSoundCloudMetadata: vi.fn(),
}));

vi.mock('fluent-ffmpeg', () => ({
  default: vi.fn((url: string) => ({
    ffprobe: (callback: (error: Error | null, data?: unknown) => void) => dependencyMocks.ffprobe(url, callback),
  })),
}));

vi.mock('array-shuffle', () => ({
  default: dependencyMocks.shuffle,
}));

vi.mock('../src/services/player.js', () => ({
  MediaSource: {Youtube: 0, HLS: 1, SoundCloud: 2},
}));

vi.mock('../src/utils/yt-dlp.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/yt-dlp.js')>(),
  getSoundCloudMetadata: dependencyMocks.getSoundCloudMetadata,
}));

import GetSongs from '../src/services/get-songs.js';
import SpotifyAPI from '../src/services/spotify-api.js';
import {YtDlpMediaUnavailableError} from '../src/utils/yt-dlp.js';

const makeSong = (title: string, url = title.toLowerCase().replaceAll(' ', '-')) => ({
  title,
  artist: 'Artist',
  url,
  length: 180,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: 0,
});

const makeGetSongsHarness = () => {
  const youtubeAPI = {
    search: vi.fn().mockResolvedValue([]),
    getVideo: vi.fn().mockResolvedValue([]),
    getPlaylist: vi.fn().mockResolvedValue([]),
  };
  const spotifyAPI = {
    getAlbum: vi.fn(),
    getPlaylist: vi.fn(),
    getTrack: vi.fn(),
    getArtist: vi.fn(),
  };

  return {
    getSongs: new GetSongs(youtubeAPI as never, spotifyAPI as never),
    spotifyAPI,
    youtubeAPI,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.ffprobe.mockImplementation((_url, callback) => callback(null, {}));
  dependencyMocks.shuffle.mockImplementation((tracks: unknown[]) => tracks);
});

describe('GetSongs provider routing', () => {
  it.each([
    'https://soundcloud.com/artist/track',
    'https://www.soundcloud.com/artist/track',
    'https://m.soundcloud.com/artist/track',
    'https://on.soundcloud.com/share-id',
    'https://snd.sc/share-id',
  ])('extracts SoundCloud metadata for %s without probing its HTML as audio', async url => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    dependencyMocks.getSoundCloudMetadata.mockResolvedValue({
      title: 'SoundCloud track', uploader: 'Uploader', duration: 181.7,
      webpage_url: 'https://soundcloud.com/artist/track',
      url: 'https://media.example/expired-signed-audio', thumbnail: 'https://images.example/art.jpg',
    });

    await expect(getSongs.getSongs(url, 20, false)).resolves.toEqual([[{
      title: 'SoundCloud track', artist: 'Uploader', length: 181.7, offset: 0,
      url, source: 2, isLive: false,
      playlist: null, thumbnailUrl: 'https://images.example/art.jpg',
    }], '']);
    expect(dependencyMocks.getSoundCloudMetadata).toHaveBeenCalledWith(url, 20);
    expect(dependencyMocks.ffprobe).not.toHaveBeenCalled();
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });

  it('caps SoundCloud playlists in source order and retains page URLs', async () => {
    const {getSongs} = makeGetSongsHarness();
    const url = 'https://soundcloud.com/artist/sets/album';
    dependencyMocks.getSoundCloudMetadata
      .mockResolvedValueOnce({title: 'Album', entries: [
        {url: 'https://soundcloud.com/artist/first'},
        {url: 'https://soundcloud.com/artist/second'},
      ]})
      .mockResolvedValueOnce({title: 'First', duration: 100});
    const [songs] = await getSongs.getSongs(url, 1, false);
    expect(songs).toEqual([expect.objectContaining({
      title: 'First', url: 'https://soundcloud.com/artist/first',
      source: 2, length: 100, playlist: {title: 'Album', source: url},
    })]);
    expect(dependencyMocks.getSoundCloudMetadata).toHaveBeenCalledWith(url, 1);
    expect(dependencyMocks.getSoundCloudMetadata).toHaveBeenCalledWith('https://soundcloud.com/artist/first', 1);
    expect(dependencyMocks.getSoundCloudMetadata).toHaveBeenCalledTimes(2);
  });

  it('propagates SoundCloud failures without falling back to ffprobe or a YouTube search', async () => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    dependencyMocks.getSoundCloudMetadata.mockRejectedValue(new Error('SoundCloud unavailable'));
    await expect(getSongs.getSongs('https://soundcloud.com/artist/removed', 20, false))
      .rejects.toThrow('SoundCloud unavailable');
    expect(dependencyMocks.ffprobe).not.toHaveBeenCalled();
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });

  it.each([
    'This video is DRM protected',
    'ERROR: [soundcloud] artist/removed: Unable to download JSON metadata: HTTP Error 404: Not Found',
  ])('retains playable SoundCloud playlist entries when another is unavailable: %s', async detail => {
    const {getSongs} = makeGetSongsHarness();
    dependencyMocks.getSoundCloudMetadata
      .mockResolvedValueOnce({title: 'Album', entries: [
        {url: 'https://soundcloud.com/artist/first'},
        {url: 'https://soundcloud.com/artist/protected'},
        {url: 'https://soundcloud.com/artist/last'},
      ]})
      .mockResolvedValueOnce({title: 'First', duration: 100})
      .mockRejectedValueOnce(new YtDlpMediaUnavailableError(detail))
      .mockResolvedValueOnce({title: 'Last', duration: 200});
    const [songs] = await getSongs.getSongs('https://soundcloud.com/artist/sets/album', 3, false);
    expect(songs.map(song => song.title)).toEqual(['First', 'Last']);
  });

  it('uses YouTube search for a free-text query', async () => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    const result = [makeSong('Search result')];
    youtubeAPI.search.mockResolvedValue(result);

    await expect(getSongs.getSongs('lofi beats', 20, true)).resolves.toEqual([result, '']);
    expect(youtubeAPI.search).toHaveBeenCalledWith('lofi beats', true);
    expect(youtubeAPI.getVideo).not.toHaveBeenCalled();
    expect(youtubeAPI.getPlaylist).not.toHaveBeenCalled();
  });

  it.each([
    'Queen:Bohemian Rhapsody',
    'C418: Sweden',
  ])('uses YouTube search for colon-bearing free text %s', async query => {
    const {getSongs, spotifyAPI, youtubeAPI} = makeGetSongsHarness();
    const result = [makeSong('Search result')];
    youtubeAPI.search.mockResolvedValue(result);

    await expect(getSongs.getSongs(query, 20, true)).resolves.toEqual([result, '']);
    expect(youtubeAPI.search).toHaveBeenCalledWith(query, true);
    expect(youtubeAPI.getVideo).not.toHaveBeenCalled();
    expect(youtubeAPI.getPlaylist).not.toHaveBeenCalled();
    expect(spotifyAPI.getTrack).not.toHaveBeenCalled();
    expect(dependencyMocks.ffprobe).not.toHaveBeenCalled();
  });

  it('routes a YouTube URL directly to the video provider', async () => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    const result = [makeSong('YouTube result', 'abcdefghijk')];
    const url = 'https://www.youtube.com/watch?v=abcdefghijk';
    youtubeAPI.getVideo.mockResolvedValue(result);

    await expect(getSongs.getSongs(url, 20, false)).resolves.toEqual([result, '']);
    expect(youtubeAPI.getVideo).toHaveBeenCalledWith(url, false);
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });

  it('routes a Spotify URL through Spotify metadata and YouTube conversion', async () => {
    const {getSongs, spotifyAPI, youtubeAPI} = makeGetSongsHarness();
    const result = [makeSong('Spotify result', 'spotify-result')];
    const url = 'spotify:track:track-id';
    spotifyAPI.getTrack.mockResolvedValue({name: 'Spotify song', artist: 'Spotify artist'});
    youtubeAPI.search.mockResolvedValue(result);

    await expect(getSongs.getSongs(url, 20, false)).resolves.toEqual([result, '']);
    expect(spotifyAPI.getTrack).toHaveBeenCalledWith(url);
    expect(youtubeAPI.search).toHaveBeenCalledWith('"Spotify song" "Spotify artist"', false);
    expect(youtubeAPI.search).not.toHaveBeenCalledWith(url, false);
  });

  it('routes a direct-stream URL through ffprobe', async () => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    const url = 'https://radio.example/live.m3u8';

    const [songs, extraMessage] = await getSongs.getSongs(url, 20, false);

    expect(songs).toEqual([expect.objectContaining({
      url,
      title: url,
      artist: url,
      isLive: true,
    })]);
    expect(extraMessage).toBe('');
    expect(dependencyMocks.ffprobe).toHaveBeenCalledWith(url, expect.any(Function));
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });

  it('propagates a YouTube provider rejection without searching the literal URL', async () => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    const error = new Error('YouTube provider failed');
    const url = 'https://www.youtube.com/watch?v=abcdefghijk';
    youtubeAPI.getVideo.mockRejectedValue(error);
    youtubeAPI.search.mockResolvedValue([makeSong('Wrong fallback')]);

    await expect(getSongs.getSongs(url, 20, false)).rejects.toBe(error);
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });

  it('propagates a Spotify provider rejection without searching the literal URL', async () => {
    const {getSongs, spotifyAPI, youtubeAPI} = makeGetSongsHarness();
    const error = new Error('Spotify provider failed');
    const url = 'spotify:track:track-id';
    spotifyAPI.getTrack.mockRejectedValue(error);
    youtubeAPI.search.mockResolvedValue([makeSong('Wrong fallback')]);

    await expect(getSongs.getSongs(url, 20, false)).rejects.toBe(error);
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });

  it.each([
    'http://radio.example/live.m3u8',
    'https://radio.example/live.m3u8',
  ])('propagates an ffprobe rejection for %s without searching the literal URL', async url => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    const error = new Error('ffprobe failed');
    dependencyMocks.ffprobe.mockImplementation((_url, callback) => callback(error));
    youtubeAPI.search.mockResolvedValue([makeSong('Wrong fallback')]);

    await expect(getSongs.getSongs(url, 20, false)).rejects.toBe(error);
    expect(youtubeAPI.search).not.toHaveBeenCalled();
  });
});

describe('GetSongs collection limits and conversion accounting', () => {
  it('caps a YouTube playlist in source order', async () => {
    const {getSongs, youtubeAPI} = makeGetSongsHarness();
    const playlist = [makeSong('First'), makeSong('Second'), makeSong('Third')];
    youtubeAPI.getPlaylist.mockResolvedValue(playlist);

    await expect(getSongs.getSongs('https://www.youtube.com/playlist?list=PL123', 2, false))
      .resolves.toEqual([[playlist[0], playlist[1]], '']);
    expect(youtubeAPI.getPlaylist).toHaveBeenCalledWith('PL123', false);
  });

  it('counts a fulfilled empty Spotify conversion as one song not found', async () => {
    const {getSongs, spotifyAPI, youtubeAPI} = makeGetSongsHarness();
    spotifyAPI.getTrack.mockResolvedValue({name: 'Missing song', artist: 'Missing artist'});
    youtubeAPI.search.mockResolvedValue([]);

    await expect(getSongs.getSongs('spotify:track:missing-id', 20, false))
      .resolves.toEqual([[], '1 song was not found']);
  });
});

describe('SpotifyAPI album pagination', () => {
  it('collects every album page before applying the configured sample limit', async () => {
    const firstTrack = {name: 'First', artists: [{name: 'First artist'}]};
    const secondTrack = {name: 'Second', artists: [{name: 'Second artist'}]};
    const spotify = {
      getAlbum: vi.fn().mockResolvedValue({
        body: {name: 'Album', href: 'https://open.spotify.com/album/album-id'},
      }),
      getAlbumTracks: vi.fn()
        .mockResolvedValueOnce({
          body: {
            items: [firstTrack],
            next: 'https://api.spotify.com/v1/albums/album-id/tracks?offset=1&limit=1',
          },
        })
        .mockResolvedValueOnce({
          body: {items: [secondTrack], next: null},
        }),
    };
    dependencyMocks.shuffle.mockImplementation((tracks: unknown[]) => [...tracks].reverse());
    const spotifyAPI = new SpotifyAPI({spotify} as never);

    await expect(spotifyAPI.getAlbum('spotify:album:album-id', 1)).resolves.toEqual([
      [{name: 'Second', artist: 'Second artist'}],
      {title: 'Album', source: 'https://open.spotify.com/album/album-id'},
    ]);
    expect(spotify.getAlbumTracks).toHaveBeenNthCalledWith(1, 'album-id', {limit: 50});
    expect(spotify.getAlbumTracks).toHaveBeenNthCalledWith(2, 'album-id', {limit: 1, offset: 1});
    expect(dependencyMocks.shuffle).toHaveBeenCalledWith([firstTrack, secondTrack]);
  });
});
