import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {PermissionFlagsBits} from 'discord.js';
import type {ChatInputCommandInteraction} from 'discord.js';

const mocks = vi.hoisted(() => ({
  getGuildSettings: vi.fn(),
  settingUpdate: vi.fn(),
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: mocks.getGuildSettings,
}));

vi.mock('../src/utils/db.js', () => ({
  prisma: {
    setting: {update: mocks.settingUpdate},
    favoriteQuery: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../src/services/player.js', () => ({
  default: class {},
  STATUS: {PLAYING: 0, PAUSED: 1, IDLE: 2},
  MediaSource: {Youtube: 0, HLS: 1},
  DEFAULT_VOLUME: 100,
}));

import Clear from '../src/commands/clear.js';
import Config from '../src/commands/config.js';
import Disconnect from '../src/commands/disconnect.js';
import Favorites from '../src/commands/favorites.js';
import ForwardSeek from '../src/commands/fseek.js';
import LoopQueue from '../src/commands/loop-queue.js';
import Loop from '../src/commands/loop.js';
import Move from '../src/commands/move.js';
import Next from '../src/commands/next.js';
import NowPlaying from '../src/commands/now-playing.js';
import Pause from '../src/commands/pause.js';
import Play from '../src/commands/play.js';
import Queue from '../src/commands/queue.js';
import Remove from '../src/commands/remove.js';
import Replay from '../src/commands/replay.js';
import Resume from '../src/commands/resume.js';
import Seek from '../src/commands/seek.js';
import Shuffle from '../src/commands/shuffle.js';
import Skip from '../src/commands/skip.js';
import Stop from '../src/commands/stop.js';
import Unskip from '../src/commands/unskip.js';
import Volume from '../src/commands/volume.js';
import {buildQueueEmbed} from '../src/utils/build-embed.js';
import durationStringToSeconds from '../src/utils/duration-string-to-seconds.js';

const STATUS = {PLAYING: 0, PAUSED: 1, IDLE: 2} as const;

const makeSong = (index: number) => ({
  title: `Song ${index}`,
  artist: 'Artist',
  url: `video${String(index).padStart(6, '0')}`,
  length: 120,
  offset: 0,
  playlist: null,
  isLive: false,
  thumbnailUrl: null,
  source: 0,
  addedInChannelId: 'channel',
  requestedBy: 'requester',
});

const makeQueuePlayer = (upcomingCount: number) => {
  const upcoming = Array.from({length: upcomingCount}, (_, index) => makeSong(index + 2));

  return {
    status: STATUS.PAUSED,
    loopCurrentSong: false,
    loopCurrentQueue: false,
    getCurrent: () => makeSong(1),
    getQueue: () => upcoming,
    queueSize: () => upcoming.length,
    getPosition: () => 0,
    getVolume: () => 100,
  };
};

const makeInteraction = (options: {
  integers?: Record<string, number | null>;
  strings?: Record<string, string | null>;
  subcommand?: string;
} = {}) => {
  const reply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);

  const interaction = {
    guild: {id: 'guild'},
    options: {
      getInteger: vi.fn((name: string) => options.integers?.[name] ?? null),
      getString: vi.fn((name: string) => options.strings?.[name] ?? null),
      getBoolean: vi.fn(() => null),
      getSubcommand: vi.fn(() => options.subcommand ?? ''),
    },
    reply,
    deferReply,
    editReply,
  } as unknown as ChatInputCommandInteraction;

  return {interaction, reply, deferReply, editReply};
};

const managerFor = (player: object) => ({get: () => player});

const COMMAND_NAMES = [
  'clear',
  'config',
  'disconnect',
  'favorites',
  'fseek',
  'loop-queue',
  'loop',
  'move',
  'next',
  'now-playing',
  'pause',
  'play',
  'queue',
  'remove',
  'replay',
  'resume',
  'seek',
  'shuffle',
  'skip',
  'stop',
  'unskip',
  'volume',
] as const;

const makeCommands = () => {
  const playerManager = {} as never;
  const addQueryToQueue = {} as never;

  return [
    new Clear(playerManager),
    new Config(),
    new Disconnect(playerManager),
    new Favorites(addQueryToQueue),
    new ForwardSeek(playerManager),
    new LoopQueue(playerManager),
    new Loop(playerManager),
    new Move(playerManager),
    new Next(playerManager),
    new NowPlaying(playerManager),
    new Pause(playerManager),
    new Play(undefined as never, {} as never, addQueryToQueue),
    new Queue(playerManager),
    new Remove(playerManager),
    new Replay(playerManager),
    new Resume(playerManager),
    new Seek(playerManager),
    new Shuffle(playerManager),
    new Skip(playerManager),
    new Stop(playerManager),
    new Unskip(playerManager),
    new Volume(playerManager),
  ];
};

interface SerializedOption {
  max_value?: number;
  min_value?: number;
  name: string;
  options?: SerializedOption[];
}

const findOption = (command: {options?: SerializedOption[]}, ...path: string[]): SerializedOption => {
  let options = command.options;
  let result: SerializedOption | undefined;

  for (const name of path) {
    result = options?.find(option => option.name === name);
    expect(result, `missing command option ${path.join(' > ')}`).toBeDefined();
    options = result?.options;
  }

  return result!;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('command metadata', () => {
  it('publishes the exact 22 unique command names', () => {
    const serialized = makeCommands().map(command => command.slashCommand.toJSON());
    const names = serialized.map(command => command.name);

    expect(serialized).toHaveLength(22);
    expect(new Set(names)).toHaveLength(22);
    expect([...names].sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it('preserves the audited voice-channel requirement matrix', () => {
    const commandsByName = new Map(makeCommands().map(command => [
      command.slashCommand.toJSON().name,
      command as {requiresVC?: boolean | ((interaction: ChatInputCommandInteraction) => boolean)},
    ]));
    const alwaysRequiresVoice = [
      'clear',
      'disconnect',
      'fseek',
      'loop-queue',
      'loop',
      'next',
      'pause',
      'play',
      'replay',
      'resume',
      'seek',
      'shuffle',
      'skip',
      'stop',
      'unskip',
      'volume',
    ];
    const neverRequiresVoice = ['config', 'move', 'now-playing', 'queue', 'remove'];

    for (const name of alwaysRequiresVoice) {
      expect(commandsByName.get(name)?.requiresVC, `/${name}`).toBe(true);
    }

    for (const name of neverRequiresVoice) {
      expect(commandsByName.get(name)?.requiresVC, `/${name}`).toBeUndefined();
    }

    const favoritesGuard = commandsByName.get('favorites')?.requiresVC;
    expect(favoritesGuard).toBeTypeOf('function');
    const interactionFor = (subcommand: string) => ({
      options: {getSubcommand: () => subcommand},
    }) as unknown as ChatInputCommandInteraction;
    expect((favoritesGuard as (interaction: ChatInputCommandInteraction) => boolean)(interactionFor('use'))).toBe(true);
    expect((favoritesGuard as (interaction: ChatInputCommandInteraction) => boolean)(interactionFor('list'))).toBe(false);
    expect((favoritesGuard as (interaction: ChatInputCommandInteraction) => boolean)(interactionFor('create'))).toBe(false);
    expect((favoritesGuard as (interaction: ChatInputCommandInteraction) => boolean)(interactionFor('remove'))).toBe(false);
  });

  it('publishes the existing audited integer option bounds', () => {
    const serialized = new Map(makeCommands().map(command => {
      const json = command.slashCommand.toJSON();
      return [json.name, json as unknown as {options?: SerializedOption[]}];
    }));

    expect(findOption(serialized.get('queue')!, 'page')).toMatchObject({min_value: 1});
    expect(findOption(serialized.get('queue')!, 'page-size')).toMatchObject({min_value: 1, max_value: 30});
    expect(findOption(serialized.get('remove')!, 'position')).toMatchObject({min_value: 1});
    expect(findOption(serialized.get('remove')!, 'range')).toMatchObject({min_value: 1});
    expect(findOption(serialized.get('volume')!, 'level')).toMatchObject({min_value: 0, max_value: 100});
    expect(findOption(serialized.get('config')!, 'set-wait-after-queue-empties', 'delay')).toMatchObject({min_value: 0});
    expect(findOption(serialized.get('config')!, 'set-reduce-vol-when-voice-target', 'volume')).toMatchObject({min_value: 0, max_value: 100});
    expect(findOption(serialized.get('config')!, 'set-default-volume', 'level')).toMatchObject({min_value: 0, max_value: 100});
    expect(findOption(serialized.get('config')!, 'set-default-queue-page-size', 'page-size')).toMatchObject({min_value: 1, max_value: 30});
  });

  it('limits /config to members with Manage Guild by default', () => {
    const config = new Config().slashCommand.toJSON();

    expect(config.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
  });
});

describe('/queue', () => {
  it('shows page 1 for a current-only queue', () => {
    const embed = buildQueueEmbed(makeQueuePlayer(0) as never, 1, 10).toJSON();

    expect(embed.fields?.find(field => field.name === 'Page')?.value).toBe('1 out of 1');
  });

  it('does not expose a phantom page for an exact multiple of upcoming tracks', () => {
    const player = makeQueuePlayer(10);
    const embed = buildQueueEmbed(player as never, 1, 10).toJSON();

    expect(embed.fields?.find(field => field.name === 'Page')?.value).toBe('1 out of 1');
    expect(() => buildQueueEmbed(player as never, 2, 10)).toThrow('the queue isn\'t that big');
  });

  it('rejects pages below 1 defensively', () => {
    expect(() => buildQueueEmbed(makeQueuePlayer(1) as never, 0, 10)).toThrow('page must be at least 1');
  });
});

describe('/remove', () => {
  it('rejects a starting position beyond the upcoming queue without replying', async () => {
    const upcoming = ['first', 'second'];
    const player = {
      queueSize: () => upcoming.length,
      removeFromQueue: vi.fn((position: number, range: number) => upcoming.splice(position - 1, range)),
    };
    const {interaction, reply} = makeInteraction({integers: {position: 3, range: 1}});

    await expect(new Remove(managerFor(player) as never).execute(interaction)).rejects.toThrow('position is outside the range of the queue');
    expect(player.removeFromQueue).not.toHaveBeenCalled();
    expect(upcoming).toEqual(['first', 'second']);
    expect(reply).not.toHaveBeenCalled();
  });

  it('removes the last valid upcoming position and replies', async () => {
    const upcoming = ['first', 'second'];
    const player = {
      queueSize: () => upcoming.length,
      removeFromQueue: vi.fn((position: number, range: number) => upcoming.splice(position - 1, range)),
    };
    const {interaction, reply} = makeInteraction({integers: {position: 2, range: 1}});

    await new Remove(managerFor(player) as never).execute(interaction);

    expect(upcoming).toEqual(['first']);
    expect(reply).toHaveBeenCalledWith(':wastebasket: removed');
  });
});

describe('/stop', () => {
  for (const [name, status] of Object.entries(STATUS)) {
    it(`stops, disconnects, and clears a connected ${name} session`, async () => {
      const queue = ['current', 'upcoming'];
      const player = {
        status,
        voiceConnection: {},
        stop: vi.fn(() => {
          player.voiceConnection = null as never;
          queue.splice(0);
        }),
      };
      const {interaction, reply} = makeInteraction();

      await new Stop(managerFor(player) as never).execute(interaction);

      expect(player.stop).toHaveBeenCalledOnce();
      expect(player.voiceConnection).toBeNull();
      expect(queue).toEqual([]);
      expect(reply).toHaveBeenCalledWith('u betcha, stopped');
    });
  }

  it('still rejects when there is no connection', async () => {
    const player = {status: STATUS.PLAYING, voiceConnection: null, stop: vi.fn()};
    const {interaction, reply} = makeInteraction();

    await expect(new Stop(managerFor(player) as never).execute(interaction)).rejects.toThrow('not connected');
    expect(player.stop).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('seek parsing', () => {
  it('rejects duration strings with trailing junk or no duration', () => {
    expect(durationStringToSeconds('1m trailing')).toBeNaN();
    expect(durationStringToSeconds('not a duration')).toBeNaN();
    expect(durationStringToSeconds('1e999s')).toBeNaN();
  });

  it('keeps valid numeric and compound durations', () => {
    expect(durationStringToSeconds('0')).toBe(0);
    expect(durationStringToSeconds('1m 30s')).toBe(90);
    expect(durationStringToSeconds('27,681 ns')).toBeCloseTo(0.000027681);
  });

  it.each(['-1', '-0:01', '-00:30', 'not-a-time', '1:bad', '1s trailing', '1e999s'])(
    '/seek rejects invalid absolute value %s without side effects',
    async value => {
      const player = {
        getCurrent: () => ({length: 300, isLive: false}),
        seek: vi.fn().mockResolvedValue(undefined),
        getPosition: () => 0,
      };
      const {interaction, deferReply, editReply} = makeInteraction({strings: {time: value}});

      await expect(new Seek(managerFor(player) as never).execute(interaction)).rejects.toThrow('invalid seek value');
      expect(player.seek).not.toHaveBeenCalled();
      expect(deferReply).not.toHaveBeenCalled();
      expect(editReply).not.toHaveBeenCalled();
    },
  );

  it('keeps /seek 0 valid', async () => {
    let position = -1;
    const player = {
      getCurrent: () => ({length: 300, isLive: false}),
      seek: vi.fn(async (value: number) => {
        position = value;
      }),
      getPosition: () => position,
    };
    const {interaction, deferReply, editReply} = makeInteraction({strings: {time: '0'}});

    await new Seek(managerFor(player) as never).execute(interaction);

    expect(player.seek).toHaveBeenCalledWith(0);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith('👍 seeked to 00:00');
  });

  it.each([
    ['+1', 1, '00:01'],
    ['0:00', 0, '00:00'],
    ['+0:01', 1, '00:01'],
  ])('keeps supported signed or zero /seek value %s valid', async (value, expectedPosition, expectedTime) => {
    let position = -1;
    const player = {
      getCurrent: () => ({length: 300, isLive: false}),
      seek: vi.fn(async (nextPosition: number) => {
        position = nextPosition;
      }),
      getPosition: () => position,
    };
    const {interaction, deferReply, editReply} = makeInteraction({strings: {time: value}});

    await new Seek(managerFor(player) as never).execute(interaction);

    expect(player.seek).toHaveBeenCalledWith(expectedPosition);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith(`👍 seeked to ${expectedTime}`);
  });

  it.each(['0', '-1', 'not-a-time', '1s trailing', '1e999s'])(
    '/fseek rejects non-positive or invalid value %s without side effects',
    async value => {
      const player = {
        getCurrent: () => ({length: 300, isLive: false}),
        getPosition: () => 10,
        forwardSeek: vi.fn().mockResolvedValue(undefined),
      };
      const {interaction, deferReply, editReply} = makeInteraction({strings: {time: value}});

      await expect(new ForwardSeek(managerFor(player) as never).execute(interaction)).rejects.toThrow('invalid seek value');
      expect(player.forwardSeek).not.toHaveBeenCalled();
      expect(deferReply).not.toHaveBeenCalled();
      expect(editReply).not.toHaveBeenCalled();
    },
  );

  it('keeps a positive finite /fseek valid', async () => {
    let position = 10;
    const player = {
      getCurrent: () => ({length: 300, isLive: false}),
      getPosition: () => position,
      forwardSeek: vi.fn(async (value: number) => {
        position += value;
      }),
    };
    const {interaction, deferReply, editReply} = makeInteraction({strings: {time: '15'}});

    await new ForwardSeek(managerFor(player) as never).execute(interaction);

    expect(player.forwardSeek).toHaveBeenCalledWith(15);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith('👍 seeked to 00:25');
  });

  it('keeps explicit-positive /fseek +1s valid', async () => {
    let position = 10;
    const player = {
      getCurrent: () => ({length: 300, isLive: false}),
      getPosition: () => position,
      forwardSeek: vi.fn(async (value: number) => {
        position += value;
      }),
    };
    const {interaction, deferReply, editReply} = makeInteraction({strings: {time: '+1s'}});

    await new ForwardSeek(managerFor(player) as never).execute(interaction);

    expect(player.forwardSeek).toHaveBeenCalledWith(1);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith('👍 seeked to 00:11');
  });
});

describe('/loop-queue', () => {
  it('accepts current plus one upcoming song', async () => {
    const player = {
      status: STATUS.PAUSED,
      queueSize: () => 1,
      loopCurrentSong: true,
      loopCurrentQueue: false,
    };
    const {interaction, reply} = makeInteraction();

    await new LoopQueue(managerFor(player) as never).execute(interaction);

    expect(player.loopCurrentSong).toBe(false);
    expect(player.loopCurrentQueue).toBe(true);
    expect(reply).toHaveBeenCalledWith('looped queue :)');
  });

  it('rejects when there is no upcoming song', async () => {
    const player = {
      status: STATUS.PAUSED,
      queueSize: () => 0,
      loopCurrentSong: false,
      loopCurrentQueue: false,
    };
    const {interaction, reply} = makeInteraction();

    await expect(new LoopQueue(managerFor(player) as never).execute(interaction)).rejects.toThrow('not enough songs to loop a queue!');
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('/config get', () => {
  it('shows requester-only responses and the voice reduction target from their own settings', async () => {
    mocks.getGuildSettings.mockResolvedValue({
      playlistLimit: 20,
      secondsToWaitAfterQueueEmpties: 30,
      leaveIfNoListeners: true,
      autoAnnounceNextSong: false,
      queueAddResponseEphemeral: true,
      defaultVolume: 80,
      defaultQueuePageSize: 10,
      turnDownVolumeWhenPeopleSpeak: true,
      turnDownVolumeWhenPeopleSpeakTarget: 23,
    });
    const {interaction, reply} = makeInteraction({subcommand: 'get'});

    await new Config().execute(interaction);

    const response = reply.mock.calls[0][0] as {embeds: Array<{toJSON: () => {description?: string}}>};
    const description = response.embeds[0].toJSON().description;
    expect(description).toContain('**Add to queue reponses show for requester only**: yes');
    expect(description).toContain('**Reduce volume when people speak target**: 23');
  });
});
