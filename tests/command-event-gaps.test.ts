import 'reflect-metadata';
import {Readable} from 'node:stream';
import {Collection} from 'discord.js';
import type {ChatInputCommandInteraction, VoiceState} from 'discord.js';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  containerGet: vi.fn(),
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(),
  entersState: vi.fn(),
  getGuildSettings: vi.fn(),
  joinVoiceChannel: vi.fn(),
  settingUpdate: vi.fn(),
}));

vi.mock('@discordjs/voice', () => ({
  AudioPlayerStatus: {Idle: 'idle'},
  VoiceConnectionDisconnectReason: {WebSocketClose: 'websocket-close'},
  VoiceConnectionStatus: {
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Ready: 'ready',
    Signalling: 'signalling',
  },
  StreamType: {WebmOpus: 'webm-opus'},
  createAudioPlayer: mocks.createAudioPlayer,
  createAudioResource: mocks.createAudioResource,
  entersState: mocks.entersState,
  joinVoiceChannel: mocks.joinVoiceChannel,
}));

vi.mock('../src/inversify.config.js', () => ({
  default: {get: mocks.containerGet},
}));

vi.mock('../src/services/file-cache.js', () => ({
  default: class {},
}));

vi.mock('../src/utils/build-embed.js', () => ({
  buildPlayingMessageEmbed: vi.fn(() => ({title: 'playing'})),
}));

vi.mock('../src/utils/db.js', () => ({
  prisma: {setting: {update: mocks.settingUpdate}},
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: mocks.getGuildSettings,
}));

import Config from '../src/commands/config.js';
import handleVoiceStateUpdate from '../src/events/voice-state-update.js';
import Player, {MediaSource, QueuedSong, STATUS} from '../src/services/player.js';

const GUILD_ID = 'guild-id';
const VOICE_CHANNEL_ID = 'voice-channel-id';

const makeAudioPlayer = () => ({
  listeners: vi.fn(() => []),
  on: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  stop: vi.fn(),
  unpause: vi.fn(),
});

const makeVoiceConnection = () => ({
  destroy: vi.fn(),
  joinConfig: {channelId: VOICE_CHANNEL_ID},
  on: vi.fn(),
  receiver: {speaking: {on: vi.fn()}},
  rejoin: vi.fn(),
  rejoinAttempts: 0,
  state: {status: 'ready'},
  subscribe: vi.fn(),
});

const makeSong = (): QueuedSong => ({
  title: 'Queued song',
  artist: 'Artist',
  url: 'video-id',
  length: 100,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: MediaSource.Youtube,
  addedInChannelId: 'text-channel-id',
  requestedBy: 'requester-id',
});

const getPrivateState = (player: Player) => player as unknown as {
  disconnectTimer: NodeJS.Timeout | null;
  finishQueue(): Promise<void>;
};

const makeConfigInteraction = (delay: number) => {
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    guild: {id: GUILD_ID},
    options: {
      getInteger: vi.fn((name: string) => name === 'delay' ? delay : null),
      getSubcommand: vi.fn(() => 'set-wait-after-queue-empties'),
    },
    reply,
  } as unknown as ChatInputCommandInteraction;

  return {interaction, reply};
};

const makeMembers = (...bots: boolean[]) => new Collection(
  bots.map((bot, index) => [`member-${index}`, {user: {bot}}]),
);

const makeVoiceEventState = (
  channelId: string | null,
  members: Collection<string, {user: {bot: boolean}}>,
): VoiceState => ({
  channelId,
  guild: {
    id: GUILD_ID,
    channels: {
      cache: new Collection([[VOICE_CHANNEL_ID, {members}]]),
    },
  },
}) as unknown as VoiceState;

const installVoiceEventPlayer = () => {
  const queue = [makeSong(), {...makeSong(), title: 'Upcoming song'}];
  const voiceConnection = makeVoiceConnection();
  const player = {
    disconnect: vi.fn(),
    getQueue: () => queue,
    guildId: GUILD_ID,
    voiceConnection,
  };

  mocks.containerGet.mockReturnValue({get: vi.fn(() => player)});

  return {player, queue, voiceConnection};
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.createAudioPlayer.mockImplementation(makeAudioPlayer);
  mocks.createAudioResource.mockImplementation((sourceStream: Readable) => ({
    sourceStream,
    volume: {setVolume: vi.fn()},
  }));
  mocks.entersState.mockResolvedValue(undefined);
  mocks.getGuildSettings.mockResolvedValue({
    autoAnnounceNextSong: false,
    leaveIfNoListeners: true,
    secondsToWaitAfterQueueEmpties: 0,
  });
  mocks.settingUpdate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('/config set-wait-after-queue-empties', () => {
  it.each([0, 37])('persists the nonnegative delay %i', async delay => {
    const {interaction, reply} = makeConfigInteraction(delay);

    await new Config().execute(interaction);

    expect(mocks.getGuildSettings).toHaveBeenCalledWith(GUILD_ID);
    expect(mocks.settingUpdate).toHaveBeenCalledWith({
      where: {guildId: GUILD_ID},
      data: {secondsToWaitAfterQueueEmpties: delay},
    });
    expect(reply).toHaveBeenCalledWith('👍 wait delay updated');
  });
});

describe('queue exhaustion disconnect delay', () => {
  it('does not schedule a disconnect when the configured delay is zero', async () => {
    const player = new Player({} as never, GUILD_ID);
    const voiceConnection = makeVoiceConnection();
    player.voiceConnection = voiceConnection as never;

    await getPrivateState(player).finishQueue();

    expect(player.status).toBe(STATUS.IDLE);
    expect(getPrivateState(player).disconnectTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(voiceConnection.destroy).not.toHaveBeenCalled();
  });

  it('disconnects after a positive delay when the player remains idle', async () => {
    const player = new Player({} as never, GUILD_ID);
    const voiceConnection = makeVoiceConnection();
    player.voiceConnection = voiceConnection as never;
    mocks.getGuildSettings.mockResolvedValue({secondsToWaitAfterQueueEmpties: 5});

    await getPrivateState(player).finishQueue();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(voiceConnection.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(voiceConnection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('does not disconnect when the player is no longer idle at timeout', async () => {
    const player = new Player({} as never, GUILD_ID);
    const voiceConnection = makeVoiceConnection();
    player.voiceConnection = voiceConnection as never;
    mocks.getGuildSettings.mockResolvedValue({secondsToWaitAfterQueueEmpties: 5});

    await getPrivateState(player).finishQueue();
    player.status = STATUS.PAUSED;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(voiceConnection.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(voiceConnection);
  });

  it('cancels a pending idle disconnect when playback starts again', async () => {
    const player = new Player({} as never, GUILD_ID);
    const voiceConnection = makeVoiceConnection();
    player.voiceConnection = voiceConnection as never;
    player.add(makeSong());
    Object.assign(player, {getStream: vi.fn().mockResolvedValue(Readable.from([]))});
    mocks.getGuildSettings.mockResolvedValue({secondsToWaitAfterQueueEmpties: 5});

    await getPrivateState(player).finishQueue();
    expect(getPrivateState(player).disconnectTimer).not.toBeNull();

    await player.play();

    expect(player.status).toBe(STATUS.PLAYING);
    expect(getPrivateState(player).disconnectTimer).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(voiceConnection.destroy).not.toHaveBeenCalled();
  });
});

describe('voice-state listener departure behavior', () => {
  it('disconnects from a bots-only configured channel when enabled without clearing the queue', async () => {
    const player = new Player({} as never, GUILD_ID);
    const voiceConnection = makeVoiceConnection();
    const current = makeSong();
    const upcoming = {...makeSong(), title: 'Upcoming song'};
    player.voiceConnection = voiceConnection as never;
    player.add(current);
    player.add(upcoming);
    mocks.containerGet.mockReturnValue({get: vi.fn(() => player)});
    const members = makeMembers(true, true);
    const oldState = makeVoiceEventState(VOICE_CHANNEL_ID, members);
    const newState = makeVoiceEventState(null, members);

    await handleVoiceStateUpdate(oldState, newState);

    expect(voiceConnection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
    expect(player.getCurrent()).toBe(current);
    expect(player.getQueue()).toEqual([upcoming]);
  });

  it('stays connected when at least one human listener remains', async () => {
    const {player} = installVoiceEventPlayer();
    const members = makeMembers(true, false);

    await handleVoiceStateUpdate(
      makeVoiceEventState(VOICE_CHANNEL_ID, members),
      makeVoiceEventState(null, members),
    );

    expect(player.disconnect).not.toHaveBeenCalled();
  });

  it('stays connected to a bots-only channel when the setting is disabled', async () => {
    const {player} = installVoiceEventPlayer();
    const members = makeMembers(true, true);
    mocks.getGuildSettings.mockResolvedValue({leaveIfNoListeners: false});

    await handleVoiceStateUpdate(
      makeVoiceEventState(VOICE_CHANNEL_ID, members),
      makeVoiceEventState(null, members),
    );

    expect(player.disconnect).not.toHaveBeenCalled();
  });

  it('ignores updates unrelated to the configured voice channel', async () => {
    const {player} = installVoiceEventPlayer();
    const members = makeMembers(true);

    await handleVoiceStateUpdate(
      makeVoiceEventState('other-channel', members),
      makeVoiceEventState(null, members),
    );

    expect(mocks.getGuildSettings).not.toHaveBeenCalled();
    expect(player.disconnect).not.toHaveBeenCalled();
  });
});
