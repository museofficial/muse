import 'reflect-metadata';
import {describe, expect, it, vi} from 'vitest';

vi.mock('../src/services/player.js', () => ({
  MediaSource: {Youtube: 0},
}));

import YoutubeAPI from '../src/services/youtube-api.js';
import GetSongs from '../src/services/get-songs.js';

interface PlaylistItemPage {
  items: Array<{
    id: string;
    contentDetails: {videoId: string};
  }>;
  nextPageToken?: string;
}

const PLAYLIST_ID = 'playlist-id';

const makeVideo = ({
  id,
  description = '',
  duration = 'PT3M',
  title = id,
}: {
  id: string;
  description?: string;
  duration?: string;
  title?: string;
}) => ({
  id,
  contentDetails: {
    videoId: id,
    duration,
  },
  snippet: {
    title,
    channelTitle: 'Channel',
    liveBroadcastContent: 'none',
    description,
    thumbnails: {
      medium: {url: `https://example.com/${id}.jpg`},
    },
  },
});

const makePlaylistItem = (videoId: string) => ({
  id: `playlist-item-${videoId}`,
  contentDetails: {videoId},
});

const makeHarness = ({
  itemCount = 0,
  pages = [],
  videos = [],
}: {
  itemCount?: number;
  pages?: PlaylistItemPage[];
  videos?: ReturnType<typeof makeVideo>[];
} = {}) => {
  const remainingPages = [...pages];
  const videoById = new Map(videos.map(video => [video.id, video]));
  let playlistItemsCallCount = 0;

  const cache = {
    wrap: vi.fn(async (
      _fetchValue: () => Promise<unknown>,
      {searchParams}: {searchParams: Record<string, string | undefined>},
    ) => {
      if (searchParams.playlistId === PLAYLIST_ID) {
        playlistItemsCallCount++;
        const page = remainingPages.shift();
        if (!page) {
          throw new Error('playlistItems page was requested again');
        }

        return page;
      }

      if (searchParams.id === PLAYLIST_ID) {
        return {
          items: [{
            id: PLAYLIST_ID,
            contentDetails: {itemCount},
            snippet: {title: 'Playlist'},
          }],
        };
      }

      const requestedVideoIds = searchParams.id?.split(',').filter(Boolean) ?? [];
      return {
        items: requestedVideoIds
          .map(id => videoById.get(id))
          .filter((video): video is ReturnType<typeof makeVideo> => Boolean(video)),
      };
    }),
  };

  return {
    api: new YoutubeAPI({YOUTUBE_API_KEY: 'test-key'} as never, cache as never),
    cache,
    getPlaylistItemsCallCount: () => playlistItemsCallCount,
  };
};

const chapterSummary = (songs: Awaited<ReturnType<YoutubeAPI['getVideo']>>) => songs.map(song => ({
  title: song.title,
  offset: song.offset,
  length: song.length,
}));

describe('YoutubeAPI playlist pagination', () => {
  it.each(['details', 'page'])('propagates a %s failure without starting later pages or leaving unhandled rejections', async failure => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {unhandled.push(reason);};
    process.on('unhandledRejection', onUnhandled);
    const detailsError = new Error('Video details unavailable');
    const pageError = new Error('Playlist page unavailable');
    let pageRequests = 0;
    const cache = {
      wrap: async (_fetch: unknown, {searchParams}: {searchParams: Record<string, string>}) => {
        if (searchParams.playlistId) {
          pageRequests++;
          if (failure === 'page') {
            throw pageError;
          }
          return {items: [makePlaylistItem('first-video')], nextPageToken: 'page-2'};
        }
        if (searchParams.id === PLAYLIST_ID) {
          return {items: [{id: PLAYLIST_ID, snippet: {title: 'Playlist'}}]};
        }
        throw detailsError;
      },
    };
    try {
      const api = new YoutubeAPI({YOUTUBE_API_KEY: 'test-key'} as never, cache as never);
      await expect(api.getPlaylist(PLAYLIST_ID, false)).rejects.toBe(failure === 'page' ? pageError : detailsError);
      await new Promise(resolve => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(pageRequests).toBe(1);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('retains all fetched details across pages and stops when the final page has no token', async () => {
    const firstVideo = makeVideo({id: 'video-first', title: 'First'});
    const secondVideo = makeVideo({id: 'video-second', title: 'Second'});
    const {api, cache, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 99,
      pages: [
        {items: [makePlaylistItem(firstVideo.id)], nextPageToken: 'page-2'},
        {items: [makePlaylistItem(secondVideo.id)]},
      ],
      videos: [firstVideo, secondVideo],
    });

    const songs = await api.getPlaylist(PLAYLIST_ID, false);

    expect(songs.map(song => ({title: song.title, url: song.url}))).toEqual([
      {title: 'First', url: firstVideo.id},
      {title: 'Second', url: secondVideo.id},
    ]);
    expect(songs.every(song => song.playlist?.source === PLAYLIST_ID)).toBe(true);
    expect(getPlaylistItemsCallCount()).toBe(2);
    expect(cache.wrap.mock.calls.filter(([, {searchParams}]) => searchParams.playlistId)
      .every(([, {searchParams}]) => searchParams.maxResults === '50')).toBe(true);
  });

  it('stops before requesting a repeated page token and retains every processed page', async () => {
    const firstVideo = makeVideo({id: 'video-first', title: 'First'});
    const secondVideo = makeVideo({id: 'video-second', title: 'Second'});
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 99,
      pages: [
        {items: [makePlaylistItem(firstVideo.id)], nextPageToken: 'page-2'},
        {items: [makePlaylistItem(secondVideo.id)], nextPageToken: 'page-2'},
      ],
      videos: [firstVideo, secondVideo],
    });

    const songs = await api.getPlaylist(PLAYLIST_ID, false);

    expect(songs.map(song => ({title: song.title, url: song.url}))).toEqual([
      {title: 'First', url: firstVideo.id},
      {title: 'Second', url: secondVideo.id},
    ]);
    expect(getPlaylistItemsCallCount()).toBe(2);
  });

  it('terminates after a truncated page without a token even when itemCount is stale', async () => {
    const onlyVideo = makeVideo({id: 'only-video', title: 'Only'});
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 50,
      pages: [{items: [makePlaylistItem(onlyVideo.id)]}],
      videos: [onlyVideo],
    });

    await expect(api.getPlaylist(PLAYLIST_ID, false)).resolves.toEqual([
      expect.objectContaining({title: 'Only', url: onlyVideo.id}),
    ]);
    expect(getPlaylistItemsCallCount()).toBe(1);
  });

  it('returns an empty playlist after one empty page without repeating the request', async () => {
    const {api, getPlaylistItemsCallCount} = makeHarness({
      itemCount: 1,
      pages: [{items: []}],
    });

    await expect(api.getPlaylist(PLAYLIST_ID, false)).resolves.toEqual([]);
    expect(getPlaylistItemsCallCount()).toBe(1);
  });
});

describe('bounded YouTube playlist imports', () => {
  it.each([2, 51])('loads only the first %s entries of a 600-video playlist through GetSongs', async limit => {
    const pageRequests: Record<string, string>[] = [];
    const detailRequests: string[][] = [];
    const cache = {
      wrap: async (_fetch: unknown, {searchParams}: {searchParams: Record<string, string>}) => {
        if (searchParams.playlistId) {
          pageRequests.push(searchParams);
          const offset = Number(searchParams.pageToken ?? 0);
          const count = Number(searchParams.maxResults);
          const nextOffset = Math.min(600, offset + count);
          return {
            items: Array.from({length: nextOffset - offset}, (_, i) => makePlaylistItem(`video-${offset + i}`)),
            ...(nextOffset < 600 ? {nextPageToken: String(nextOffset)} : {}),
          };
        }

        if (searchParams.id === PLAYLIST_ID) {
          return {items: [{id: PLAYLIST_ID, contentDetails: {itemCount: 600}, snippet: {title: 'Large playlist'}}]};
        }

        const ids = searchParams.id.split(',');
        detailRequests.push(ids);
        return {items: ids.map(id => makeVideo({id}))};
      },
    };
    const api = new YoutubeAPI({YOUTUBE_API_KEY: 'test-key'} as never, cache as never);
    const [songs] = await new GetSongs(api).getSongs(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}`, limit, false);

    expect(songs.map(song => song.url)).toEqual(Array.from({length: limit}, (_, i) => `video-${i}`));
    expect(pageRequests).toHaveLength(Math.ceil(limit / 50));
    expect(pageRequests.map(page => page.maxResults)).toEqual(limit === 2 ? ['2'] : ['50', '1']);
    expect(detailRequests.flat()).toEqual(songs.map(song => song.url));
  });

  it('continues past missing and malformed entries until enough playable songs are found', async () => {
    const {api, getPlaylistItemsCallCount} = makeHarness({
      pages: [
        {items: [makePlaylistItem('deleted'), makePlaylistItem('malformed')], nextPageToken: 'page-2'},
        {items: [makePlaylistItem('first'), makePlaylistItem('second')], nextPageToken: 'unused-page'},
      ],
      videos: [makeVideo({id: 'malformed', duration: 'invalid'}), makeVideo({id: 'first'}), makeVideo({id: 'second'})],
    });

    const songs = await api.getPlaylist(PLAYLIST_ID, false, 2);

    expect(songs.map(song => song.url)).toEqual(['first', 'second']);
    expect(getPlaylistItemsCallCount()).toBe(2);
  });

  it('counts split chapters toward the output limit and stops within the final video', async () => {
    const {api, cache, getPlaylistItemsCallCount} = makeHarness({
      pages: [
        {items: [makePlaylistItem('first')], nextPageToken: 'page-2'},
        {items: [makePlaylistItem('second')], nextPageToken: 'unused-page'},
      ],
      videos: ['first', 'second'].map(id => makeVideo({id, description: '0:00 Intro\n1:00 Main', duration: 'PT2M'})),
    });

    const songs = await api.getPlaylist(PLAYLIST_ID, true, 3);

    expect(chapterSummary(songs)).toEqual([
      {title: 'Intro (first)', offset: 0, length: 60},
      {title: 'Main (first)', offset: 60, length: 60},
      {title: 'Intro (second)', offset: 0, length: 60},
    ]);
    expect(getPlaylistItemsCallCount()).toBe(2);
    const pages = cache.wrap.mock.calls.filter(([, {searchParams}]) => searchParams.playlistId);
    expect(pages.map(([, {searchParams}]) => searchParams.maxResults)).toEqual(['3', '1']);
  });

  it('preserves duplicate playlist entries and their source ordering', async () => {
    const {api} = makeHarness({
      pages: [
        {items: ['second', 'first'].map(makePlaylistItem), nextPageToken: 'page-2'},
        {items: [makePlaylistItem('second')]},
      ],
      videos: [makeVideo({id: 'first'}), makeVideo({id: 'second'})],
    });

    expect((await api.getPlaylist(PLAYLIST_ID, false, 3)).map(song => song.url)).toEqual(['second', 'first', 'second']);
  });

  it('returns an empty result without fetching when no tracks can be added', async () => {
    const {api, cache} = makeHarness();

    await expect(api.getPlaylist(PLAYLIST_ID, false, 0)).resolves.toEqual([]);
    expect(cache.wrap).not.toHaveBeenCalled();
  });

  it('shares the three-request detail limit across independent imports and direct video lookups', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {release = resolve;});
    let active = 0;
    let peak = 0;
    const detailCalls: string[] = [];
    const cache = {wrap: (fetchValue: () => Promise<unknown>) => fetchValue()};
    const api = new YoutubeAPI({YOUTUBE_API_KEY: 'test-key'} as never, cache as never);
    Object.defineProperty(api, 'got', {value: (endpoint: string, {searchParams}: {searchParams: Record<string, string>}) => ({
      json: async () => {
        if (endpoint === 'playlists') {
          return {items: [{id: searchParams.id, snippet: {title: searchParams.id}}]};
        }
        if (endpoint === 'playlistItems') {
          return {items: [makePlaylistItem(searchParams.playlistId)]};
        }
        detailCalls.push(searchParams.id);
        active++;
        peak = Math.max(peak, active);
        await blocked;
        active--;
        return {items: [makeVideo({id: searchParams.id})]};
      },
    })});

    const results = Promise.all([
      ...Array.from({length: 4}, (_, i) => api.getPlaylist(`playlist-${i}`, false, 1)),
      api.getVideo('direct00001', false),
      api.getVideo('direct00002', false),
    ]);
    try {
      await new Promise(resolve => setImmediate(resolve));
      expect(detailCalls).toHaveLength(3);
      expect(peak).toBe(3);
    } finally {
      release();
      expect(await results).toHaveLength(6);
    }
    expect(detailCalls).toHaveLength(6);
    expect(peak).toBe(3);
  });
});

describe('YoutubeAPI chapter parsing', () => {
  it.each(['0:00', '00:00'])('accepts an exact %s first chapter timestamp', async start => {
    const video = makeVideo({
      id: 'chaptered01',
      duration: 'PT2M',
      title: 'Chaptered video',
      description: `${start} Intro\n1:00 Main`,
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toHaveLength(2);
  });

  it.each(['0:00:00', '00:00:00'])('accepts an all-zero hour-form %s first chapter timestamp', async start => {
    const video = makeVideo({
      id: 'hours000001',
      duration: 'PT2M',
      title: 'Hour-form chapters',
      description: `${start} Intro\n0:01:00 Main`,
    });
    const {api} = makeHarness({videos: [video]});

    expect(chapterSummary(await api.getVideo(video.id, true))).toEqual([
      {title: 'Intro (Hour-form chapters)', offset: 0, length: 60},
      {title: 'Main (Hour-form chapters)', offset: 60, length: 60},
    ]);
  });

  it('does not treat 10:00 as a zero-start timestamp by substring', async () => {
    const video = makeVideo({
      id: 'notzero0001',
      duration: 'PT20M',
      title: 'Unsplit video',
      description: '10:00 First mention\n11:00 Second mention',
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toEqual([
      expect.objectContaining({
        title: video.snippet.title,
        offset: 0,
        length: 1200,
      }),
    ]);
  });

  it('scans past an incidental earlier timestamp to find a later zero-start chapter block', async () => {
    const video = makeVideo({
      id: 'laterzero01',
      duration: 'PT3M',
      title: 'Chaptered video',
      description: '10:00 Preface\n0:00 Intro\n1:00 Main',
    });
    const {api} = makeHarness({videos: [video]});

    expect(chapterSummary(await api.getVideo(video.id, true))).toEqual([
      {title: 'Intro (Chaptered video)', offset: 0, length: 60},
      {title: 'Main (Chaptered video)', offset: 60, length: 120},
    ]);
  });

  it.each([
    ['descending offsets', '0:00 Intro\n1:30 Middle\n1:00 Backwards'],
    ['repeated offsets', '0:00 Intro\n1:00 Middle\n1:00 Duplicate'],
    ['an offset at the video duration', '0:00 Intro\n2:00 At end'],
    ['an offset outside the video duration', '0:00 Intro\n2:01 Too late'],
    ['an empty label', '0:00\n1:00 Main'],
  ])('falls back to the unsplit video for %s', async (_caseName, description) => {
    const video = makeVideo({
      id: 'invalid0001',
      duration: 'PT2M',
      title: 'Unsplit video',
      description,
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toEqual([
      expect.objectContaining({
        title: video.snippet.title,
        offset: 0,
        length: 120,
      }),
    ]);
  });

  it('calculates every valid chapter length from the next offset and video duration', async () => {
    const video = makeVideo({
      id: 'valid000001',
      duration: 'PT2M',
      title: 'Chaptered video',
      description: '00:00 Intro\n0:45 Verse\n1:30 Outro',
    });
    const {api} = makeHarness({videos: [video]});

    await expect(api.getVideo(video.id, true)).resolves.toSatisfy(songs => {
      expect(chapterSummary(songs)).toEqual([
        {title: 'Intro (Chaptered video)', offset: 0, length: 45},
        {title: 'Verse (Chaptered video)', offset: 45, length: 45},
        {title: 'Outro (Chaptered video)', offset: 90, length: 30},
      ]);
      return true;
    });
  });

  it('preserves valid chapters that have duplicate non-empty labels', async () => {
    const video = makeVideo({
      id: 'duplicate01',
      duration: 'PT2M',
      title: 'Chaptered video',
      description: '0:00 Part\n0:30 Part\n1:00 Finale',
    });
    const {api} = makeHarness({videos: [video]});

    const songs = await api.getVideo(video.id, true);

    expect(chapterSummary(songs)).toEqual([
      {title: 'Part (Chaptered video)', offset: 0, length: 30},
      {title: 'Part (Chaptered video)', offset: 30, length: 30},
      {title: 'Finale (Chaptered video)', offset: 60, length: 60},
    ]);
  });
});
