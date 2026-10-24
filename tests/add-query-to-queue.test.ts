import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  buildQueueEmbed: vi.fn(() => ({title: 'queue'})),
  getGuildSettings: vi.fn(),
  getMemberVoiceChannel: vi.fn(),
  getMostPopularVoiceChannel: vi.fn(),
}));

vi.mock('../src/utils/build-embed.js', () => ({
  buildQueueEmbed: dependencyMocks.buildQueueEmbed,
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
    member: {user: {id: 'requester-id'}},
    channel: {id: 'text-channel-id'},
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(replyMessage),
    replyMessage,
  };
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
}: {
  player: object;
  songs?: SongMetadata[];
  extraMessage?: string;
  cacheWrap?: (fetchValue: () => Promise<unknown>) => Promise<unknown>;
  getSongs?: ReturnType<typeof vi.fn>;
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
  };
  const cache = {
    wrap: vi.fn(cacheWrap ?? (async (fetchValue: () => Promise<unknown>) => fetchValue())),
  };

  return {
    cache,
    service: new AddQueryToQueue(songProvider as never, playerManager as never, config as never, cache as never),
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
  dependencyMocks.buildQueueEmbed.mockImplementation(() => ({title: 'queue'}));
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
  it('keeps ephemeral live responses on the interaction webhook without adding reactions', async () => {
    dependencyMocks.getGuildSettings.mockResolvedValue({
      playlistLimit: 50,
      queueAddResponseEphemeral: true,
      defaultQueuePageSize: 5,
    });
    const player = makePausedPlayer();
    player.status = STATUS.IDLE;
    vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const registerUpdater = vi.spyOn(player, 'setPlayingMessageUpdater');
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction);
    const update = registerUpdater.mock.calls[0][0];
    await update();
    expect(interaction.deferReply).toHaveBeenCalledWith({ephemeral: true});
    expect(dependencyMocks.buildQueueEmbed).toHaveBeenLastCalledWith(player, 1, 5);
    expect(interaction.editReply).toHaveBeenLastCalledWith({embeds: [{title: 'queue'}]});
    expect(player.isPlayingMessage('playing-message-id')).toBe(false);

    await update('stopped');
    expect(interaction.editReply).toHaveBeenLastCalledWith({content: 'Playback stopped.', embeds: []});
    expect(interaction.replyMessage.edit).not.toHaveBeenCalled();
    expect(interaction.replyMessage.react).not.toHaveBeenCalled();
    expect(interaction.replyMessage.reactions.removeAll).not.toHaveBeenCalled();
  });

  it('keeps the newly requested song current on an empty player and does not claim a skip', async () => {
    const queue: QueuedSong[] = [];
    const player = {
      voiceConnection: null as object | null,
      status: STATUS.IDLE,
      getCurrent: vi.fn(() => queue[0] ?? null),
      getCurrentQueueEntryId: vi.fn(() => queue.length === 0 ? null : 1),
      add: vi.fn((song: QueuedSong) => queue.push(song)),
      connect: vi.fn(async () => {
        player.voiceConnection = {state: {status: 'ready'}};
      }),
      play: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined),
      setPlayingMessageUpdater: vi.fn(),
      setPlayingMessageId: vi.fn().mockReturnValue(true),
      isPlayingMessage: vi.fn().mockReturnValue(true),
    };
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction, {skip: true});

    expect(player.getCurrent()?.title).toBe('New song');
    expect(player.connect).toHaveBeenCalledOnce();
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.forward).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: 'u betcha, **New song** added to the queue',
      embeds: [{title: 'queue'}],
    });
    expect(dependencyMocks.buildQueueEmbed).toHaveBeenCalledWith(player, 1, 10);
    expect(player.setPlayingMessageUpdater).toHaveBeenCalledOnce();
    expect(player.setPlayingMessageUpdater).toHaveBeenCalledWith(expect.any(Function));
    expect(player.setPlayingMessageId).toHaveBeenCalledWith(expect.any(Function), 'playing-message-id');
    expect(interaction.replyMessage.react.mock.calls.map(([emoji]) => emoji)).toEqual([
      '⏮️',
      '⏪',
      '⏯️',
      '⏩',
      '⏭️',
      '⏹️',
      '🔀',
    ]);

    const updatePlayingMessage = player.setPlayingMessageUpdater.mock.calls[0][0] as () => Promise<void>;
    await updatePlayingMessage();

    expect(interaction.replyMessage.edit).toHaveBeenCalledWith({
      embeds: [{title: 'queue'}],
    });

    queue.splice(0);
    await (updatePlayingMessage as (state: 'finished') => Promise<void>)('finished');

    expect(interaction.replyMessage.edit).toHaveBeenLastCalledWith({
      content: 'u betcha, **New song** added to the queue',
      embeds: [],
    });
    expect(interaction.replyMessage.reactions.removeAll).toHaveBeenCalledOnce();
  });

  it('skips a pre-existing current track and reports the skip with correct spacing', async () => {
    const player = makePausedPlayer(makeQueuedSong('Existing song'));
    const forward = vi.spyOn(player, 'forward');
    const {service} = makeService({player});
    const interaction = makeInteraction();

    await addToQueue(service, interaction, {skip: true});

    expect(forward).toHaveBeenCalledWith(1);
    expect(player.getCurrent()?.title).toBe('New song');
    expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue and current track skipped');
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
    expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue');
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
    expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue');
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
    expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue');
  });
});

describe('AddQueryToQueue live response publication', () => {
  const acknowledgment = 'u betcha, **Final song** added to the queue';

  const finishNaturally = async (player: Player) => (player as unknown as {
    onAudioPlayerIdle(previous: object, current: {status: string}): Promise<void>;
  }).onAudioPlayerIdle({}, {status: 'idle'});

  const useRealQueueEmbed = async () => {
    const {buildQueueEmbed} = await vi.importActual<typeof import('../src/utils/build-embed.js')>('../src/utils/build-embed.js');
    dependencyMocks.buildQueueEmbed.mockImplementation(buildQueueEmbed as never);
  };

  const expectFinishedAcknowledgment = (edit: ReturnType<typeof vi.fn>, content = acknowledgment) => {
    expect(edit).toHaveBeenLastCalledWith({content, embeds: []});
  };

  const publish = (player: Player, interaction: ReturnType<typeof makeInteraction>, ephemeral = false, content = acknowledgment) => {
    const {service} = makeService({player});
    return (service as unknown as {
      sendPlayingMessage(options: object): Promise<void>;
    }).sendPlayingMessage({interaction, player, content, pageSize: 10, ephemeral});
  };

  it.each([false, true])('renders the stopped state after disconnect clears a real queue (publication pending=%s)', async pendingPublication => {
    const {buildQueueEmbed} = await vi.importActual<typeof import('../src/utils/build-embed.js')>('../src/utils/build-embed.js');
    dependencyMocks.buildQueueEmbed.mockImplementation(buildQueueEmbed as never);
    const player = makePausedPlayer(makeQueuedSong('Current song'));
    player.status = STATUS.PLAYING;
    Object.assign(player.voiceConnection!, {destroy: vi.fn()});
    const interaction = makeInteraction();
    const barrier = makePromiseBarrier();
    interaction.editReply.mockImplementationOnce(async () => {
      await barrier.wait();
      return interaction.replyMessage;
    });

    const pending = publish(player, interaction);
    await barrier.entered;
    if (!pendingPublication) {
      barrier.release();
      await pending;
    }

    player.stop();
    expect(player.getCurrent()).toBeNull();
    barrier.release();
    await pending;

    await vi.waitFor(() => expect(interaction.replyMessage.edit).toHaveBeenLastCalledWith({
      content: 'Playback stopped.', embeds: [],
    }));
    expect(interaction.replyMessage.reactions.removeAll).toHaveBeenCalledOnce();
    expect(player.isPlayingMessage(interaction.replyMessage.id)).toBe(false);
  });

  it.each([
    {terminal: 'stopped', ephemeral: false},
    {terminal: 'finished', ephemeral: false},
    {terminal: 'stopped', ephemeral: true},
    {terminal: 'finished', ephemeral: true},
  ])('preserves $terminal while the initial response is pending (ephemeral=$ephemeral)', async ({terminal, ephemeral}) => {
    await useRealQueueEmbed();
    const player = makePausedPlayer(makeQueuedSong('Final song'));
    player.status = STATUS.PLAYING;
    Object.assign(player.voiceConnection!, {destroy: vi.fn()});
    const interaction = makeInteraction();
    const barrier = makePromiseBarrier();
    interaction.editReply.mockImplementationOnce(async () => {
      await barrier.wait();
      return interaction.replyMessage;
    });

    const pending = publish(player, interaction, ephemeral);
    await barrier.entered;
    if (terminal === 'stopped') {
      player.stop();
    } else {
      await finishNaturally(player);
      expect(player.getCurrent()).toBeNull();
    }

    barrier.release();
    await pending;
    const edit = ephemeral ? interaction.editReply : interaction.replyMessage.edit;
    if (terminal === 'stopped') {
      await vi.waitFor(() => expect(edit).toHaveBeenLastCalledWith({content: 'Playback stopped.', embeds: []}));
    } else {
      await vi.waitFor(() => expectFinishedAcknowledgment(edit));
    }
    expect(player.isPlayingMessage(interaction.replyMessage.id)).toBe(false);
    expect(interaction.replyMessage.react).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(interaction.replyMessage.reactions.removeAll).toHaveBeenCalledTimes(ephemeral ? 0 : 1));
  });

  it('does not replace a newer response when an older initial edit completes', async () => {
    const player = new Player({} as never, GUILD_ID);
    const interaction = makeInteraction();
    const barrier = makePromiseBarrier();
    interaction.editReply.mockImplementationOnce(async () => {
      await barrier.wait();
      return interaction.replyMessage;
    });

    const pending = publish(player, interaction);
    await barrier.entered;
    player.stop();
    const newerUpdater = vi.fn().mockResolvedValue(undefined);
    player.setPlayingMessageUpdater(newerUpdater, 'newer-message');
    barrier.release();
    await pending;

    await vi.waitFor(() => expect(interaction.replyMessage.edit).toHaveBeenCalledWith({
      content: 'Playback stopped.', embeds: [],
    }));
    expect(player.isPlayingMessage('newer-message')).toBe(true);
    expect(player.isPlayingMessage(interaction.replyMessage.id)).toBe(false);
    expect(interaction.replyMessage.react).not.toHaveBeenCalled();
  });

  it('waits for an in-flight reaction before removing terminal controls', async () => {
    const player = new Player({} as never, GUILD_ID);
    const interaction = makeInteraction();
    const barrier = makePromiseBarrier();
    const completed: string[] = [];
    interaction.replyMessage.react.mockImplementationOnce(async () => {
      await barrier.wait();
      completed.push('reaction-added');
    });
    interaction.replyMessage.reactions.removeAll.mockImplementation(async () => {
      completed.push('controls-removed');
    });

    const pending = publish(player, interaction);
    await barrier.entered;
    player.stop();
    expect(player.isPlayingMessage(interaction.replyMessage.id)).toBe(false);
    await vi.waitFor(() => expect(interaction.replyMessage.edit).toHaveBeenCalledWith({
      content: 'Playback stopped.', embeds: [],
    }));
    expect(interaction.replyMessage.reactions.removeAll).not.toHaveBeenCalled();
    barrier.release();
    await pending;

    await vi.waitFor(() => expect(completed).toEqual(['reaction-added', 'controls-removed']));
    expect(interaction.replyMessage.react).toHaveBeenCalledOnce();
    expect(interaction.replyMessage.edit).toHaveBeenLastCalledWith({
      content: 'Playback stopped.', embeds: [],
    });
  });

  it.each(['stopped', 'finished'])('finishes the old %s response while a new response is publishing', async terminal => {
    const {buildQueueEmbed} = await vi.importActual<typeof import('../src/utils/build-embed.js')>('../src/utils/build-embed.js');
    dependencyMocks.buildQueueEmbed.mockImplementation(buildQueueEmbed as never);
    const player = makePausedPlayer(makeQueuedSong('Old session'));
    player.status = STATUS.PLAYING;
    Object.assign(player.voiceConnection!, {destroy: vi.fn()});
    const oldInteraction = makeInteraction();
    const oldAcknowledgment = 'u betcha, **Old session** added to the queue';
    await publish(player, oldInteraction, false, oldAcknowledgment);
    const progress = makePromiseBarrier();
    oldInteraction.replyMessage.edit.mockImplementationOnce(() => progress.wait());
    player.refreshPlayingMessage();
    await progress.entered;

    if (terminal === 'stopped') {
      player.stop();
    } else {
      await finishNaturally(player);
      expect(player.getCurrent()).toBeNull();
    }

    player.add(makeQueuedSong('New session'));
    player.status = STATUS.PLAYING;
    const newInteraction = makeInteraction();
    const newAcknowledgment = 'u betcha, **New session** added to the queue';
    newInteraction.replyMessage.id = 'newer-message';
    const publication = makePromiseBarrier();
    newInteraction.editReply.mockImplementationOnce(async () => {
      await publication.wait();
      return newInteraction.replyMessage;
    });
    const pending = publish(player, newInteraction, false, newAcknowledgment);
    await publication.entered;
    progress.release();

    try {
      if (terminal === 'stopped') {
        await vi.waitFor(() => expect(oldInteraction.replyMessage.edit).toHaveBeenLastCalledWith({
          content: 'Playback stopped.', embeds: [],
        }));
      } else {
        await vi.waitFor(() => expectFinishedAcknowledgment(oldInteraction.replyMessage.edit, oldAcknowledgment));
      }
      await vi.waitFor(() => expect(oldInteraction.replyMessage.reactions.removeAll).toHaveBeenCalledOnce());
      expect(player.isPlayingMessage(oldInteraction.replyMessage.id)).toBe(false);
    } finally {
      publication.release();
      await pending;
    }

    expect(player.isPlayingMessage(newInteraction.replyMessage.id)).toBe(true);
    expect(newInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({content: newAcknowledgment}));
    expect(newInteraction.replyMessage.reactions.removeAll).not.toHaveBeenCalled();
    expect(newInteraction.replyMessage.react).toHaveBeenCalledTimes(7);
  });

  it('restores the original queue acknowledgment after a short final track ends during a progress edit', async () => {
    await useRealQueueEmbed();
    const player = makePausedPlayer(makeQueuedSong('First song'), makeQueuedSong('Short final song'));
    player.status = STATUS.PLAYING;
    vi.spyOn(player, 'play').mockResolvedValue(undefined);
    const interaction = makeInteraction();
    const originalAcknowledgment = 'u betcha, **First song** and 1 other songs were added to the queue';
    await publish(player, interaction, false, originalAcknowledgment);
    const progress = makePromiseBarrier();
    interaction.replyMessage.edit.mockImplementationOnce(() => progress.wait());
    player.refreshPlayingMessage();
    await progress.entered;

    await player.forward(1);
    Object.assign(player, {positionInSeconds: 2});
    await finishNaturally(player);
    expect(player.getCurrent()).toBeNull();
    progress.release();

    await vi.waitFor(() => expectFinishedAcknowledgment(interaction.replyMessage.edit, originalAcknowledgment));
    await vi.waitFor(() => expect(interaction.replyMessage.reactions.removeAll).toHaveBeenCalledOnce());
    expect(player.isPlayingMessage(interaction.replyMessage.id)).toBe(false);
    const edits = interaction.replyMessage.edit.mock.calls.length;
    player.refreshPlayingMessage();
    expect(interaction.replyMessage.edit).toHaveBeenCalledTimes(edits);
  });

  it('clears finished controls after a pending reaction even if the final edit fails', async () => {
    await useRealQueueEmbed();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const player = makePausedPlayer(makeQueuedSong('Final song'));
    player.status = STATUS.PLAYING;
    const interaction = makeInteraction();
    const reaction = makePromiseBarrier();
    interaction.replyMessage.react.mockImplementationOnce(() => reaction.wait());
    interaction.replyMessage.edit.mockRejectedValue(new Error('Discord unavailable'));
    const pending = publish(player, interaction);
    await reaction.entered;

    await finishNaturally(player);
    await vi.waitFor(() => expectFinishedAcknowledgment(interaction.replyMessage.edit));
    expect(interaction.replyMessage.reactions.removeAll).not.toHaveBeenCalled();
    reaction.release();
    await pending;

    await vi.waitFor(() => expect(interaction.replyMessage.reactions.removeAll).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(interaction.replyMessage.react).toHaveBeenCalledOnce();
    expect(player.isPlayingMessage(interaction.replyMessage.id)).toBe(false);
    warn.mockRestore();
  });

  it('restores the queue acknowledgment when an unplayable final entry empties the queue', async () => {
    await useRealQueueEmbed();
    const player = makePausedPlayer(makeQueuedSong('Unavailable final song'));
    const interaction = makeInteraction();
    await publish(player, interaction);

    await (player as unknown as {advancePastUnplayableTrack(): Promise<void>}).advancePastUnplayableTrack();

    expect(player.getCurrent()).toBeNull();
    await vi.waitFor(() => expectFinishedAcknowledgment(interaction.replyMessage.edit));
    await vi.waitFor(() => expect(interaction.replyMessage.reactions.removeAll).toHaveBeenCalledOnce());
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
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content: 'u betcha, **New song** added to the queue (resuming playback)',
      embeds: [{title: 'queue'}],
    });
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
  expect(player.getQueue().map(song => song.title)).toEqual(['New song']);
  expect(interaction.editReply).toHaveBeenLastCalledWith('u betcha, **New song** added to the queue');
});
