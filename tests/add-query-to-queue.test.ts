import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  getGuildSettings: vi.fn(),
  getMemberVoiceChannel: vi.fn(),
  getMostPopularVoiceChannel: vi.fn(),
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

const makeInteraction = () => {
  const replyMessage = {
    edit: vi.fn().mockResolvedValue(undefined),
    id: 'playing-message-id',
    react: vi.fn().mockResolvedValue(undefined),
    reactions: {removeAll: vi.fn().mockResolvedValue(undefined)},
  };

  return {
    guild: {id: GUILD_ID},
    locale: 'en-US',
    member: {user: {id: 'requester-id'}},
    channel: {id: 'text-channel-id'},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(replyMessage),
    replyMessage,
  };
};

const replyContent = (interaction: ReturnType<typeof makeInteraction>): string => {
  const payload = interaction.editReply.mock.calls.at(-1)?.[0] as string | {content: string};
  return typeof payload === 'string' ? payload : payload.content;
};

const makePausedPlayer = (...songs: QueuedSong[]) => {
  const player = new Player({} as never, GUILD_ID);
  songs.forEach(song => player.add(song));
  player.voiceConnection = {state: {status: 'ready'}} as never;
  player.status = STATUS.PAUSED;
  return player;
};

const makePromiseBarrier = () => {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    markEntered = resolve;
  });
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });

  return {
    entered,
    release,
    wait: async () => {
      markEntered();
      await blocked;
    },
  };
};

const makeService = ({
  player,
  songs = [makeSong('New song')],
  extraMessage = '',
  cacheWrap,
  getSongs,
  attachToReply = vi.fn().mockResolvedValue(undefined),
  introSoundTrigger = 'join',
}: {
  player: object;
  songs?: SongMetadata[];
  extraMessage?: string;
  cacheWrap?: (fetchValue: () => Promise<unknown>) => Promise<unknown>;
  getSongs?: ReturnType<typeof vi.fn>;
  attachToReply?: ReturnType<typeof vi.fn>;
  introSoundTrigger?: 'join' | 'queue-start';
}) => {
  const songProvider = {
    getSongs: getSongs ?? vi.fn().mockResolvedValue([songs, extraMessage]),
  };
  const playerManager = {
    get: vi.fn(() => player),
  };
  const config = {
    ENABLE_SPONSORBLOCK: false,
    SPONSORBLOCK_TIMEOUT: 5,
    INTRO_SOUND_TRIGGER: introSoundTrigger,
  };
  const cache = {
    wrap: vi.fn(cacheWrap ?? (async (fetchValue: () => Promise<unknown>) => fetchValue())),
  };

  return {
    cache,
    attachToReply,
    service: new AddQueryToQueue(songProvider as never, playerManager as never, config as never, cache as never, {attachToReply} as never),
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
  vi.spyOn(Player.prototype, 'prepareAudio').mockImplementation(() => undefined);
  dependencyMocks.getGuildSettings.mockResolvedValue({
    playlistLimit: 50,
    queueAddResponseEphemeral: false,
    defaultQueuePageSize: 10,
    secondsToWaitAfterQueueEmpties: 0,
  });
  dependencyMocks.getMemberVoiceChannel.mockReturnValue([{id: 'voice-channel-id'}]);
  dependencyMocks.getMostPopularVoiceChannel.mockReturnValue([{id: 'fallback-voice-channel-id'}]);
});

describe('AddQueryToQueue skip semantics', () => {
  it.each([false, true])('publishes attributed confirmations with legacy hidden setting=%s', async queueAddResponseEphemeral => {
    dependencyMocks.getGuildSettings.mockResolvedValue({playlistLimit: 50, queueAddResponseEphemeral});
    const player = makePausedPlayer(makeQueuedSong('Existing song'));
    const {service, attachToReply} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: false});
    expect(attachToReply).toHaveBeenCalledWith(player, interaction.channel, expect.any(Promise));
    expect(replyContent(interaction)).toBe('u betcha, **New song** added to the queue');
    expect(replyContent(interaction)).not.toContain('Go to player');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({allowedMentions: {parse: []}}));
    expect(interaction.replyMessage.react).not.toHaveBeenCalled();
  });

  it('keeps the newly requested song current on an empty player and does not claim a skip', async () => {
    const player = makePausedPlayer();
    player.status = STATUS.IDLE;
    player.voiceConnection = null;
    const connect = vi.spyOn(player, 'connect').mockImplementation(async () => {
      player.voiceConnection = {state: {status: 'ready'}} as never;
    });
    const playIntro = vi.spyOn(player, 'playIntro');
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const forward = vi.spyOn(player, 'forward');
    const {service, attachToReply} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction, {skip: true, immediate: true});

    expect(player.getCurrent()?.title).toBe('New song');
    expect(connect).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(playIntro.mock.invocationCallOrder[0]).toBeLessThan(play.mock.invocationCallOrder[0]);
    expect(forward).not.toHaveBeenCalled();
    expect(attachToReply).toHaveBeenCalledWith(player, interaction.channel, expect.any(Promise));
    expect(replyContent(interaction)).toBe('u betcha, **New song** added to the front of the queue');
    expect(replyContent(interaction)).not.toMatch(/skipped/i);
    expect(interaction.replyMessage.react).not.toHaveBeenCalled();
  });

  it.each([
    ['join', 0],
    ['queue-start', 1],
  ] as const)('with INTRO_SOUND_TRIGGER=%s, restarting a finished queue in voice plays the intro %i time(s)', async (introSoundTrigger, intros) => {
    const player = makePausedPlayer();
    player.status = STATUS.IDLE;
    vi.spyOn(player, 'ensureVoiceConnectionReady').mockResolvedValue(player.voiceConnection!);
    const playIntro = vi.spyOn(player, 'playIntro').mockResolvedValue(undefined);
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const {service} = makeService({player, introSoundTrigger});

    await addToQueue(service, makeInteraction());

    expect(playIntro).toHaveBeenCalledTimes(intros);
    expect(play).toHaveBeenCalledOnce();
  });

  it.each(['join', 'queue-start'] as const)('with INTRO_SOUND_TRIGGER=%s, joining voice plays the intro', async introSoundTrigger => {
    const player = makePausedPlayer();
    player.status = STATUS.IDLE;
    player.voiceConnection = null;
    vi.spyOn(player, 'connect').mockImplementation(async () => {
      player.voiceConnection = {state: {status: 'ready'}} as never;
    });
    const playIntro = vi.spyOn(player, 'playIntro').mockResolvedValue(undefined);
    vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const {service} = makeService({player, introSoundTrigger});

    await addToQueue(service, makeInteraction());

    expect(playIntro).toHaveBeenCalledOnce();
  });

  it('does not play the intro when adding to a queue that is already playing', async () => {
    const player = makePausedPlayer(makeQueuedSong('Existing song'));
    player.status = STATUS.PLAYING;
    vi.spyOn(player, 'ensureVoiceConnectionReady').mockResolvedValue(player.voiceConnection!);
    const playIntro = vi.spyOn(player, 'playIntro').mockResolvedValue(undefined);
    const {service} = makeService({player, introSoundTrigger: 'queue-start'});

    await addToQueue(service, makeInteraction());

    expect(playIntro).not.toHaveBeenCalled();
  });

  it('skips a pre-existing current track and reports the skip with correct spacing', async () => {
    const player = makePausedPlayer(makeQueuedSong('Existing song'));
    const forward = vi.spyOn(player, 'forward');
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction, {skip: true});

    expect(forward).toHaveBeenCalledWith(1);
    expect(player.getCurrent()?.title).toBe('New song');
    expect(replyContent(interaction)).toBe('u betcha, **New song** added to the queue and current track skipped');
  });

  it('preserves playback startup failures from the skip path', async () => {
    const player = makePausedPlayer(makeQueuedSong('Existing song'));
    const failure = new Error('FFmpeg startup failed');
    vi.spyOn(player, 'forward').mockRejectedValue(failure);
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await expect(addToQueue(service, interaction, {skip: true})).rejects.toBe(failure);
  });

  it('does not skip after the captured current entry advances while song lookup is blocked', async () => {
    const player = makePausedPlayer(
      makeQueuedSong('Captured current'),
      makeQueuedSong('Already upcoming'),
    );
    const forward = vi.spyOn(player, 'forward');
    const barrier = makePromiseBarrier();
    const getSongs = vi.fn(async () => {
      await barrier.wait();
      return [[makeSong('New song')], ''];
    });
    const {service} = makeService({player, getSongs});
    const interaction = makeInteraction();

    const request = addToQueue(service, interaction, {skip: true});
    await barrier.entered;
    player.manualForward(1);
    expect(player.getCurrent()?.title).toBe('Already upcoming');

    barrier.release();
    await request;

    expect(player.getCurrent()?.title).toBe('Already upcoming');
    expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
    expect(forward).not.toHaveBeenCalled();
    expect(replyContent(interaction)).toContain('New song');
    expect(replyContent(interaction)).not.toMatch(/skipped/i);
  });

  it('does not skip the new current song after the captured entry disappears during song lookup', async () => {
    const player = makePausedPlayer(makeQueuedSong('Captured current'));
    const forward = vi.spyOn(player, 'forward');
    const barrier = makePromiseBarrier();
    const getSongs = vi.fn(async () => {
      await barrier.wait();
      return [[makeSong('New song')], ''];
    });
    const {service} = makeService({player, getSongs});
    const interaction = makeInteraction();

    const request = addToQueue(service, interaction, {skip: true});
    await barrier.entered;
    player.removeCurrent();
    expect(player.getCurrent()).toBeNull();

    barrier.release();
    await request;

    expect(player.getCurrent()?.title).toBe('New song');
    expect(player.getQueue()).toEqual([]);
    expect(forward).not.toHaveBeenCalled();
    expect(replyContent(interaction)).toContain('New song');
    expect(replyContent(interaction)).not.toMatch(/skipped/i);
  });

  it('does not treat a looped reuse of the same song object as the captured queue entry', async () => {
    const repeatedSong = makeQueuedSong('Repeated song');
    const player = makePausedPlayer(repeatedSong);
    const forward = vi.spyOn(player, 'forward');
    const barrier = makePromiseBarrier();
    const getSongs = vi.fn(async () => {
      await barrier.wait();
      return [[makeSong('New song')], ''];
    });
    const {service} = makeService({player, getSongs});
    const interaction = makeInteraction();

    const request = addToQueue(service, interaction, {skip: true});
    await barrier.entered;
    player.add(repeatedSong);
    player.manualForward(1);
    expect(player.getCurrent()).toBe(repeatedSong);

    barrier.release();
    await request;

    expect(player.getCurrent()).toBe(repeatedSong);
    expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
    expect(forward).not.toHaveBeenCalled();
    expect(replyContent(interaction)).toContain('New song');
    expect(replyContent(interaction)).not.toMatch(/skipped/i);
  });
});

describe('AddQueryToQueue shared player publication', () => {
  it('captures the receipt for the current session before Discord finishes publishing it', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'));
    const receipt = makePromiseBarrier();
    const interaction = makeInteraction();
    interaction.editReply.mockImplementationOnce(async () => {
      await receipt.wait();
      return interaction.replyMessage;
    });
    const attachToReply = vi.fn(async (_player, _channel, pendingReceipt) => {
      await pendingReceipt;
    });
    const {service} = makeService({player, attachToReply});

    const pending = addToQueue(service, interaction);
    await receipt.entered;

    expect(attachToReply).toHaveBeenCalledWith(player, interaction.channel, interaction.editReply.mock.results[0].value);
    expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
    expect(interaction.editReply).toHaveBeenCalledOnce();

    receipt.release();
    await pending;
    expect(attachToReply).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();
  });

  it('keeps the confirmation readable when a long escaped title must be shortened', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'));
    const {service} = makeService({player, songs: [makeSong('*Long title* '.repeat(200))]});
    const interaction = makeInteraction();

    await addToQueue(service, interaction);

    expect(replyContent(interaction).length).toBeLessThanOrEqual(2000);
    expect(replyContent(interaction)).toMatch(/^u betcha, \*\*\\\*Long title\\\*/);
    expect(replyContent(interaction)).toMatch(/added to the queue$/);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({allowedMentions: {parse: []}}));
  });

  it('confirms queued songs while the shared card is still publishing', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'));
    const card = makePromiseBarrier();
    const attachToReply = vi.fn(async () => {
      await card.wait();
      return 'https://discord.com/channels/guild-id/text-channel-id/session-card-id';
    });
    const {service} = makeService({player, attachToReply});
    const interaction = makeInteraction();

    const pending = addToQueue(service, interaction);
    await card.entered;

    expect(attachToReply).toHaveBeenCalledWith(player, interaction.channel, expect.any(Promise));
    expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
    expect(replyContent(interaction)).toBe('u betcha, **New song** added to the queue');

    card.release();
    await pending;
    expect(interaction.editReply).toHaveBeenCalledOnce();
  });

  it('keeps thinking through audio startup but does not wait for the new card to confirm it', async () => {
    const player = makePausedPlayer();
    player.status = STATUS.IDLE;
    const audio = makePromiseBarrier();
    const card = makePromiseBarrier();
    vi.spyOn(player, 'play').mockImplementation(async () => {
      await audio.wait();
      player.status = STATUS.PLAYING;
    });
    const attachToReply = vi.fn(async () => {
      await card.wait();
      return 'https://discord.com/channels/guild-id/text-channel-id/session-card-id';
    });
    const {service} = makeService({player, attachToReply});
    const interaction = makeInteraction();

    const pending = addToQueue(service, interaction);
    await audio.entered;
    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: false});
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(attachToReply).not.toHaveBeenCalled();

    audio.release();
    await card.entered;
    expect(player.status).toBe(STATUS.PLAYING);
    expect(replyContent(interaction)).toBe('u betcha, **New song** added to the queue');

    card.release();
    await pending;
    expect(interaction.editReply).toHaveBeenCalledOnce();
  });

  it('propagates startup failures without publishing a success receipt or player card', async () => {
    const player = makePausedPlayer();
    player.status = STATUS.IDLE;
    const failure = new Error('FFmpeg startup failed');
    vi.spyOn(player, 'play').mockRejectedValue(failure);
    const {service, attachToReply} = makeService({player});
    const interaction = makeInteraction();

    await expect(addToQueue(service, interaction)).rejects.toBe(failure);

    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(attachToReply).not.toHaveBeenCalled();
  });

  it('adds a late publication warning to the same bounded public confirmation', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'));
    const card = makePromiseBarrier();
    const attachToReply = vi.fn(async () => {
      await card.wait();
      throw new Error('Missing Permissions');
    });
    const {service} = makeService({player, attachToReply, songs: [makeSong('*Long title* '.repeat(200))]});
    const interaction = makeInteraction();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const pending = addToQueue(service, interaction);
    await card.entered;
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(replyContent(interaction)).toMatch(/^u betcha, /);
    expect(replyContent(interaction)).not.toContain('could not be shown');

    card.release();
    await pending;

    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    expect(replyContent(interaction)).toMatch(/^u betcha, /);
    expect(replyContent(interaction)).toContain('The player card could not be shown.');
    expect(player.getQueue().map(song => song.title)).toEqual(['*Long title* '.repeat(200)]);
    for (const [payload] of interaction.editReply.mock.calls) {
      expect(payload.content.length).toBeLessThanOrEqual(2000);
      expect(payload.allowedMentions).toEqual({parse: []});
      expect(payload.content).not.toContain('<@requester-id>');
    }

    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('waits for the first receipt to finish before appending an early card failure', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'));
    const receipt = makePromiseBarrier();
    const {service} = makeService({player, attachToReply: vi.fn().mockRejectedValue(new Error('Missing Permissions'))});
    const interaction = makeInteraction();
    interaction.editReply.mockImplementationOnce(async () => {
      await receipt.wait();
      return interaction.replyMessage;
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const pending = addToQueue(service, interaction);
    await receipt.entered;
    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(replyContent(interaction)).not.toContain('could not be shown');

    receipt.release();
    await pending;

    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    expect(replyContent(interaction)).toContain('The player card could not be shown.');
    warning.mockRestore();
  });

  it('hands each public receipt to the shared player without adding a player link', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'), makeQueuedSong('Already queued'));
    const {service, attachToReply} = makeService({player});
    const first = makeInteraction();
    const second = makeInteraction();

    await addToQueue(service, first);
    await addToQueue(service, second);

    expect(attachToReply).toHaveBeenCalledTimes(2);
    for (const interaction of [first, second]) {
      expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: false});
      expect(replyContent(interaction)).toBe('u betcha, **New song** added to the queue');
      expect(replyContent(interaction)).not.toContain('session-card-id');
      expect(interaction.replyMessage.react).not.toHaveBeenCalled();
    }
  });

  it('confirms queued songs if the public card cannot be sent', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'));
    const {service} = makeService({player, attachToReply: vi.fn().mockRejectedValue(new Error('Missing Permissions'))});
    const interaction = makeInteraction();

    await addToQueue(service, interaction);

    expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
    expect(replyContent(interaction)).toMatch(/^u betcha, \*\*New song\*\* added to the queue\n/);
    expect(replyContent(interaction)).toMatch(/card|player/i);
    expect(replyContent(interaction)).toMatch(/could not|couldn't|unavailable/i);
  });

  it('names the first playlist song and the remaining count in one public reply', async () => {
    const player = makePausedPlayer(makeQueuedSong('Current'), makeQueuedSong('Already queued'));
    const {service} = makeService({player, songs: [makeSong('*First*'), makeSong('Second')], extraMessage: '1 song was not found'});
    const interaction = makeInteraction();

    await addToQueue(service, interaction);

    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(replyContent(interaction)).toBe('u betcha, **\\*First\\*** and 1 other songs were added to the queue (1 song was not found)');
    expect(replyContent(interaction)).not.toContain('session-card-id');
  });
});

describe('AddQueryToQueue immediate batch insertion', () => {
  it('keeps the first song current and preserves the rest of an immediate batch on an empty player', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = {state: {status: 'ready'}} as never;
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
    player.voiceConnection = {state: {status: 'ready'}} as never;
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
    player.voiceConnection = {state: {status: 'ready'}} as never;
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
  it.each([
    {name: 'a later chapter with a video outro', offset: 120, length: 60,
      segments: [{startTime: 0, endTime: 10}, {startTime: 170, endTime: 180}], expected: {offset: 120, length: 50}},
    {name: 'an earlier chapter before the video outro', offset: 0, length: 60,
      segments: [{startTime: 170, endTime: 180}], expected: {offset: 0, length: 60}},
    {name: 'a middle chapter outside the video intro and outro', offset: 60, length: 60,
      segments: [{startTime: 0, endTime: 10}, {startTime: 170, endTime: 180}], expected: {offset: 60, length: 60}},
    {name: 'segments crossing both chapter boundaries', offset: 60, length: 60,
      segments: [{startTime: 55, endTime: 65}, {startTime: 115, endTime: 125}], expected: {offset: 65, length: 50}},
    {name: 'a segment covering the whole chapter', offset: 60, length: 60,
      segments: [{startTime: 55, endTime: 125}], expected: {offset: 120, length: 0}},
  ])('respects source timestamps for $name', async ({offset, length, segments, expected}) => {
    const {service} = makeService({player: {}});
    setSponsorBlock(service, vi.fn().mockResolvedValue(segments));
    const song = makeSong('Chapter', {offset, length});

    await expect(skipNonMusicSegments(service, song)).resolves.toMatchObject(expected);
  });

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


describe('AddQueryToQueue voice connection failures', () => {
  it.each([false, true])('prepares the correct audio during a pending join with saved queue=%s', async hasSavedQueue => {
    const player = new Player({} as never, GUILD_ID);
    const current = makeQueuedSong('Saved current');
    if (hasSavedQueue) {
      player.add(current);
    }

    const connection = makePromiseBarrier();
    vi.spyOn(player, 'connect').mockImplementation(async () => {
      await connection.wait();
      player.voiceConnection = {state: {status: 'ready'}} as never;
    });
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const {service} = makeService({player});
    const interaction = makeInteraction();

    const pending = addToQueue(service, interaction);
    await connection.entered;
    expect(player.getCurrent()).toBe(hasSavedQueue ? current : null);
    expect(player.getQueue()).toEqual([]);
    expect(play).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(player.prepareAudio).toHaveBeenCalledOnce();
    expect(player.prepareAudio).toHaveBeenCalledWith(hasSavedQueue ? current : makeQueuedSong('New song'));

    connection.release();
    await pending;

    const preparedSong = vi.mocked(player.prepareAudio).mock.calls[0][0];
    expect(player.getCurrent()).toBe(preparedSong);
    expect(play).toHaveBeenCalledOnce();
    expect(replyContent(interaction)).toContain('New song');
  });

  it.each([false, true])('does not enqueue failed requests with immediate=%s or disturb the saved queue', async immediate => {
    const player = new Player({} as never, GUILD_ID);
    const current = makeQueuedSong('Saved current');
    const upcoming = makeQueuedSong('Saved next');
    player.add(current);
    player.add(upcoming);
    vi.spyOn(player, 'connect').mockRejectedValue(new Error('voice join timed out'));
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const {service} = makeService({player});
    const interaction = makeInteraction();

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(addToQueue(service, interaction, {immediate})).rejects.toThrow('voice join timed out');
    }

    expect(player.getCurrent()).toBe(current);
    expect(player.getQueue()).toEqual([upcoming]);
    expect(player.prepareAudio).toHaveBeenCalledTimes(2);
    expect(player.prepareAudio).toHaveBeenCalledWith(current);
    expect(play).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('waits for an already pending handshake before adding a concurrent request', async () => {
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = {state: {status: 'connecting'}} as never;
    const barrier = makePromiseBarrier();
    vi.spyOn(player, 'ensureVoiceConnectionReady').mockImplementation(async () => {
      await barrier.wait();
      throw new Error('shared join failed');
    });
    const {service} = makeService({player});
    const interaction = makeInteraction();
    const pending = addToQueue(service, interaction);
    await barrier.entered;
    expect(player.getCurrent()).toBeNull();
    barrier.release();
    await expect(pending).rejects.toThrow('shared join failed');
    expect(player.getCurrent()).toBeNull();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('still resumes a saved queue after a successful connection', async () => {
    const player = new Player({} as never, GUILD_ID);
    const current = makeQueuedSong('Saved current');
    player.add(current);
    vi.spyOn(player, 'connect').mockResolvedValue(undefined);
    const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction);

    expect(player.getCurrent()).toBe(current);
    expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
    expect(play).toHaveBeenCalledOnce();
    expect(replyContent(interaction)).toBe('u betcha, **New song** added to the queue (resuming playback)');
  });
});


it.each([STATUS.PAUSED, STATUS.PLAYING])('preserves an established %s session while it recovers during a queue add', async status => {
  const player = new Player({} as never, GUILD_ID);
  const existingConnection = {state: {status: 'connecting'}, joinConfig: {channelId: 'original-channel'}};
  player.voiceConnection = existingConnection as never;
  player.status = status;
  player.loopCurrentSong = true;
  player.add(makeQueuedSong('Existing song'));
  const barrier = makePromiseBarrier();
  const connect = vi.spyOn(player, 'connect');
  const play = vi.spyOn(player, 'play');
  vi.spyOn(player, 'ensureVoiceConnectionReady').mockImplementation(async () => {
    await barrier.wait();
    existingConnection.state.status = 'ready';
    return existingConnection as never;
  });
  const {service} = makeService({player});
  const interaction = makeInteraction();
  const request = addToQueue(service, interaction);
  await barrier.entered;
  expect(player.getQueue()).toEqual([]);
  barrier.release();
  await request;

  expect(player.voiceConnection).toBe(existingConnection);
  expect(player.voiceConnection?.joinConfig.channelId).toBe('original-channel');
  expect(player.status).toBe(status);
  expect(player.loopCurrentSong).toBe(true);
  expect(connect).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  expect(player.prepareAudio).not.toHaveBeenCalled();
  expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
  expect(replyContent(interaction)).toContain('New song');
  expect(replyContent(interaction)).not.toMatch(/skipped/i);
});
