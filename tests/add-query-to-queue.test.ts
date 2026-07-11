import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  buildPlayingMessageEmbed: vi.fn(() => ({title: 'playing'})),
  getGuildSettings: vi.fn(),
  getMemberVoiceChannel: vi.fn(),
  getMostPopularVoiceChannel: vi.fn(),
}));

vi.mock('../src/utils/build-embed.js', () => ({
  buildPlayingMessageEmbed: dependencyMocks.buildPlayingMessageEmbed,
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: dependencyMocks.getGuildSettings,
}));

vi.mock('../src/utils/channels.js', () => ({
  getMemberVoiceChannel: dependencyMocks.getMemberVoiceChannel,
  getMostPopularVoiceChannel: dependencyMocks.getMostPopularVoiceChannel,
}));

import AddQueryToQueue from '../src/services/add-query-to-queue.js';
import Player, {MediaSource, QueuedSong, SongMetadata, STATUS} from '../src/services/player.js';

const GUILD_ID = 'guild-id';

const makeSong = (title: string, overrides: Partial<SongMetadata> = {}): SongMetadata => ({
  title,
  artist: 'Artist',
  url: title.toLowerCase().replaceAll(' ', '-'),
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  ...overrides,
});

const makeQueuedSong = (title: string, overrides: Partial<SongMetadata> = {}): QueuedSong => ({
  ...makeSong(title, overrides),
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
});

const makeInteraction = () => ({
  guild: {id: GUILD_ID},
  member: {user: {id: 'requester-id'}},
  channel: {id: 'text-channel-id'},
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
});

const makeService = ({
  player,
  songs = [makeSong('New song')],
  extraMessage = '',
  cacheWrap,
}: {
  player: object;
  songs?: SongMetadata[];
  extraMessage?: string;
  cacheWrap?: (fetchValue: () => Promise<unknown>) => Promise<unknown>;
}) => {
  const getSongs = {
    getSongs: vi.fn().mockResolvedValue([songs, extraMessage]),
  };
  const playerManager = {
    get: vi.fn(() => player),
  };
  const config = {
    ENABLE_SPONSORBLOCK: false,
    SPONSORBLOCK_TIMEOUT: 5,
  };
  const cache = {
    wrap: vi.fn(cacheWrap ?? (async (fetchValue: () => Promise<unknown>) => fetchValue())),
  };

  return {
    cache,
    service: new AddQueryToQueue(getSongs as never, playerManager as never, config as never, cache as never),
  };
};

const addToQueue = async (
  service: AddQueryToQueue,
  interaction: ReturnType<typeof makeInteraction>,
  {
    immediate = false,
    skip = false,
  }: {immediate?: boolean; skip?: boolean} = {},
) => service.addToQueue({
  query: 'request',
  addToFrontOfQueue: immediate,
  shuffleAdditions: false,
  shouldSplitChapters: true,
  skipCurrentTrack: skip,
  interaction: interaction as never,
});

const skipNonMusicSegments = (service: AddQueryToQueue, song: SongMetadata) => (
  service as unknown as {
    skipNonMusicSegments(input: SongMetadata): Promise<SongMetadata>;
  }
).skipNonMusicSegments(song);

const setSponsorBlock = (
  service: AddQueryToQueue,
  getSegments: ReturnType<typeof vi.fn>,
) => Object.assign(service, {
  sponsorBlock: {getSegments},
});

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.getGuildSettings.mockResolvedValue({
    playlistLimit: 50,
    queueAddResponseEphemeral: false,
  });
  dependencyMocks.getMemberVoiceChannel.mockReturnValue([{id: 'voice-channel-id'}]);
  dependencyMocks.getMostPopularVoiceChannel.mockReturnValue([{id: 'fallback-voice-channel-id'}]);
});

describe('AddQueryToQueue skip semantics', () => {
  it('keeps the newly requested song current on an empty player and does not claim a skip', async () => {
    const queue: QueuedSong[] = [];
    const player = {
      voiceConnection: null as object | null,
      status: STATUS.IDLE,
      getCurrent: vi.fn(() => queue[0] ?? null),
      add: vi.fn((song: QueuedSong) => queue.push(song)),
      connect: vi.fn(async () => {
        player.voiceConnection = {};
      }),
      play: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined),
    };
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction, {skip: true});

    expect(queue.map(song => song.title)).toEqual(['New song']);
    expect(player.getCurrent()?.title).toBe('New song');
    expect(player.forward).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue');
  });

  it('skips a pre-existing current track and reports the skip with correct spacing', async () => {
    const queue = [makeQueuedSong('Existing song')];
    const player = {
      voiceConnection: {},
      status: STATUS.PLAYING,
      getCurrent: vi.fn(() => queue[0] ?? null),
      add: vi.fn((song: QueuedSong) => queue.push(song)),
      connect: vi.fn().mockResolvedValue(undefined),
      play: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined),
    };
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction, {skip: true});

    expect(player.forward).toHaveBeenCalledWith(1);
    expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue and current track skipped');
  });
});

describe('AddQueryToQueue immediate batch insertion', () => {
  it('keeps the first song current and preserves the rest of an immediate batch on an empty player', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = {} as never;
    player.status = STATUS.PLAYING;
    const songs = [
      makeSong('First requested'),
      makeSong('Second requested'),
      makeSong('Third requested'),
    ];
    const {service} = makeService({player, songs});

    await addToQueue(service, makeInteraction(), {immediate: true});

    expect(player.getCurrent()?.title).toBe('First requested');
    expect(player.getQueue().map(song => song.title)).toEqual([
      'Second requested',
      'Third requested',
    ]);
  });

  it('places a playlist-tagged batch immediately after current and before the old queue', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.add(makeQueuedSong('Current'));
    player.add(makeQueuedSong('Old upcoming'));
    player.voiceConnection = {} as never;
    player.status = STATUS.PLAYING;
    const playlist = {title: 'Playlist', source: 'playlist-id'};
    const songs = [
      makeSong('Playlist one', {playlist}),
      makeSong('Playlist two', {playlist}),
    ];
    const {service} = makeService({player, songs});

    await addToQueue(service, makeInteraction(), {immediate: true});

    expect(player.getQueue().map(song => song.title)).toEqual([
      'Playlist one',
      'Playlist two',
      'Old upcoming',
    ]);
  });

  it('preserves split-chapter order when the whole batch is added immediately', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.add(makeQueuedSong('Current'));
    player.add(makeQueuedSong('Old upcoming'));
    player.voiceConnection = {} as never;
    player.status = STATUS.PLAYING;
    const songs = [
      makeSong('Chapter one', {url: 'split-video', offset: 0, length: 30}),
      makeSong('Chapter two', {url: 'split-video', offset: 30, length: 40}),
      makeSong('Chapter three', {url: 'split-video', offset: 70, length: 30}),
    ];
    const {service} = makeService({player, songs});

    await addToQueue(service, makeInteraction(), {immediate: true});

    expect(player.getQueue().map(song => ({title: song.title, offset: song.offset}))).toEqual([
      {title: 'Chapter one', offset: 0},
      {title: 'Chapter two', offset: 30},
      {title: 'Chapter three', offset: 70},
      {title: 'Old upcoming', offset: 0},
    ]);
  });
});

describe('AddQueryToQueue SponsorBlock trimming', () => {
  it('keeps the maximum end when an overlapping segment is contained by the previous one', async () => {
    const player = {};
    const {service} = makeService({player});
    setSponsorBlock(service, vi.fn().mockResolvedValue([
      {startTime: 0, endTime: 40},
      {startTime: 10, endTime: 20},
    ]));
    const song = makeSong('Contained overlap');

    await expect(skipNonMusicSegments(service, song)).resolves.toMatchObject({
      offset: 40,
      length: 60,
    });
  });

  it('trims disjoint intro and outro segments exactly once each', async () => {
    const player = {};
    const {service} = makeService({player});
    setSponsorBlock(service, vi.fn().mockResolvedValue([
      {startTime: 0, endTime: 10},
      {startTime: 90, endTime: 100},
    ]));
    const song = makeSong('Disjoint segments');

    await expect(skipNonMusicSegments(service, song)).resolves.toMatchObject({
      offset: 10,
      length: 80,
    });
  });

  it('does not subtract one full-length segment twice or produce a negative length', async () => {
    const player = {};
    const {service} = makeService({player});
    setSponsorBlock(service, vi.fn().mockResolvedValue([
      {startTime: 0, endTime: 100},
    ]));
    const song = makeSong('Full segment');

    await expect(skipNonMusicSegments(service, song)).resolves.toMatchObject({
      offset: 100,
      length: 0,
    });
    expect(song.length).toBeGreaterThanOrEqual(0);
  });

  it('returns the song unchanged when the SponsorBlock provider fails', async () => {
    const player = {};
    const {service} = makeService({player});
    setSponsorBlock(service, vi.fn().mockRejectedValue(new Error('provider unavailable')));
    const song = makeSong('Provider failure');
    const original = {...song};
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(skipNonMusicSegments(service, song)).resolves.toBe(song);
    expect(song).toEqual(original);
    warning.mockRestore();
  });

  it('backs off after a 504 and leaves later songs unchanged without another provider call', async () => {
    const player = {};
    const {service, cache} = makeService({player});
    const getSegments = vi.fn().mockRejectedValue(new Error('504 Gateway Timeout'));
    setSponsorBlock(service, getSegments);
    const firstSong = makeSong('First failure');
    const laterSong = makeSong('During backoff');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(skipNonMusicSegments(service, firstSong)).resolves.toBe(firstSong);
    await expect(skipNonMusicSegments(service, laterSong)).resolves.toBe(laterSong);

    expect(firstSong).toEqual(makeSong('First failure'));
    expect(laterSong).toEqual(makeSong('During backoff'));
    expect(cache.wrap).toHaveBeenCalledTimes(1);
    expect(getSegments).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
});
