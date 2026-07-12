import 'reflect-metadata';
import {ActivityType, ChannelType, Collection} from 'discord.js';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => {
  const spinner = {
    start: vi.fn(),
    succeed: vi.fn(),
    text: '',
  };
  spinner.start.mockReturnValue(spinner);

  return {
    containerGet: vi.fn(),
    containerGetAll: vi.fn(),
    debug: vi.fn(),
    dependencyReport: vi.fn(() => 'dependency report'),
    login: vi.fn(),
    playerConstructions: [] as Array<{
      fileCache: unknown;
      findAudioFallback: (song: unknown) => Promise<unknown>;
      guildId: string;
    }>,
    restPut: vi.fn(),
    restSetToken: vi.fn(),
    settingUpsert: vi.fn(),
    spinner,
    voiceStateHandler: vi.fn(),
  };
});

vi.mock('ora', () => ({
  default: vi.fn(() => mocks.spinner),
}));

vi.mock('@discordjs/rest', () => ({
  REST: class {
    setToken(token: string) {
      mocks.restSetToken(token);
      return this;
    }

    put(route: string, options: unknown) {
      return mocks.restPut(route, options);
    }
  },
}));

vi.mock('@discordjs/voice', () => ({
  generateDependencyReport: mocks.dependencyReport,
}));

vi.mock('../src/inversify.config.js', () => ({
  default: {
    get: mocks.containerGet,
    getAll: mocks.containerGetAll,
  },
}));

vi.mock('../src/utils/db.js', () => ({
  prisma: {
    setting: {upsert: mocks.settingUpsert},
  },
}));

vi.mock('../src/utils/debug.js', () => ({
  default: mocks.debug,
}));

vi.mock('../src/events/voice-state-update.js', () => ({
  default: mocks.voiceStateHandler,
}));

vi.mock('../src/services/player.js', () => ({
  default: class {
    readonly fileCache: unknown;
    readonly findAudioFallback: (song: unknown) => Promise<unknown>;
    readonly guildId: string;

    constructor(fileCache: unknown, guildId: string, findAudioFallback: (song: unknown) => Promise<unknown>) {
      this.fileCache = fileCache;
      this.guildId = guildId;
      this.findAudioFallback = findAudioFallback;
      mocks.playerConstructions.push(this);
    }
  },
}));

import Bot from '../src/bot.js';
import PlayerManager from '../src/managers/player.js';
import {TYPES} from '../src/types.js';

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

type Handler = (...args: never[]) => unknown;

interface StructuralCommand {
  execute?: ReturnType<typeof vi.fn>;
  requiresVC?: boolean | ((interaction: StructuralInteraction) => boolean);
  slashCommand: {
    name: string;
    toJSON: ReturnType<typeof vi.fn>;
  };
}

interface StructuralInteraction {
  commandName: string;
  deferred: boolean;
  editReply: ReturnType<typeof vi.fn>;
  guild: object | null;
  isAutocomplete: () => boolean;
  isButton: () => boolean;
  isChatInputCommand: () => boolean;
  isCommand: () => boolean;
  member?: {user: {id: string}};
  options: {getSubcommand: () => string};
  replied: boolean;
  reply: ReturnType<typeof vi.fn>;
}

const makeCommand = (name: string, overrides: Partial<StructuralCommand> = {}): StructuralCommand => ({
  execute: vi.fn().mockResolvedValue(undefined),
  slashCommand: {
    name,
    toJSON: vi.fn(() => ({description: `${name} command`, name})),
  },
  ...overrides,
});

const makeCommandSet = () => COMMAND_NAMES.map(name => makeCommand(name));

const makeConfig = (registerCommandsOnBot: boolean, activityUrl = '') => ({
  BOT_ACTIVITY: 'preservation music',
  BOT_ACTIVITY_TYPE: ActivityType.Streaming,
  BOT_ACTIVITY_URL: activityUrl,
  BOT_STATUS: 'idle' as const,
  DISCORD_TOKEN: 'fake-token',
  REGISTER_COMMANDS_ON_BOT: registerCommandsOnBot,
});

const makeClient = (guildIds: string[] = []) => {
  const handlers = new Map<string, Handler>();
  const setPresence = vi.fn();
  const client = {
    guilds: {
      cache: new Collection(guildIds.map(id => [id, {id}])),
    },
    login: mocks.login,
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return client;
    }),
    once: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return client;
    }),
    user: {
      id: 'application-id',
      setPresence,
    },
  };

  return {client, handlers, setPresence};
};

const makeInteraction = (commandName: string, overrides: Partial<StructuralInteraction> = {}): StructuralInteraction => ({
  commandName,
  deferred: false,
  editReply: vi.fn().mockResolvedValue(undefined),
  guild: {channels: {cache: new Collection()}},
  isAutocomplete: () => false,
  isButton: () => false,
  isChatInputCommand: () => true,
  isCommand: () => true,
  member: {user: {id: 'member-id'}},
  options: {getSubcommand: () => 'list'},
  replied: false,
  reply: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const registerBot = async (registerCommandsOnBot: boolean, commands = makeCommandSet(), guildIds: string[] = []) => {
  const config = makeConfig(registerCommandsOnBot, 'https://example.test/stream');
  const clientState = makeClient(guildIds);

  mocks.containerGetAll.mockReturnValue(commands);
  mocks.containerGet.mockImplementation(type => {
    if (type === TYPES.Config) {
      return config;
    }

    if (type === TYPES.Client) {
      return clientState.client;
    }

    throw new Error('unexpected container lookup');
  });

  const bot = new Bot(clientState.client as never, config as never);
  await bot.register();

  return {...clientState, commands, config};
};

const invoke = async (handlers: Map<string, Handler>, event: string, ...args: unknown[]) => {
  const handler = handlers.get(event);
  expect(handler).toBeTypeOf('function');
  await handler!(...args as never[]);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.login.mockResolvedValue(undefined);
  mocks.restPut.mockResolvedValue(undefined);
  mocks.settingUpsert.mockResolvedValue({guildId: 'guild-new'});
  mocks.spinner.text = '';
  mocks.spinner.start.mockReturnValue(mocks.spinner);
  mocks.playerConstructions.splice(0);
});

describe('Discord command registration and ready lifecycle', () => {
  it('replaces global commands with the full command set in bot registration mode', async () => {
    const {commands, handlers, setPresence} = await registerBot(true, makeCommandSet(), ['guild-a', 'guild-b']);

    expect(mocks.login).toHaveBeenCalledOnce();
    expect(mocks.login).toHaveBeenCalledWith();
    await invoke(handlers, 'ready');

    expect(mocks.restSetToken).toHaveBeenCalledWith('fake-token');
    expect(mocks.restPut).toHaveBeenCalledOnce();
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/commands', {
      body: commands.map(command => command.slashCommand.toJSON()),
    });
    expect(setPresence).toHaveBeenCalledAfter(mocks.restPut);
  });

  it('registers every cached guild and removes global commands in guild registration mode', async () => {
    const {commands, handlers} = await registerBot(false, makeCommandSet(), ['guild-a', 'guild-b']);

    await invoke(handlers, 'ready');

    const body = commands.map(command => command.slashCommand.toJSON());
    expect(mocks.restPut).toHaveBeenCalledTimes(3);
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/guilds/guild-a/commands', {body});
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/guilds/guild-b/commands', {body});
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/commands', {body: []});
  });

  it('applies configured presence and reports dependency diagnostics plus the invite link', async () => {
    const {handlers, setPresence} = await registerBot(true);

    await invoke(handlers, 'ready');

    expect(mocks.dependencyReport).toHaveBeenCalledOnce();
    expect(mocks.debug).toHaveBeenCalledWith('dependency report');
    expect(setPresence).toHaveBeenCalledWith({
      activities: [{
        name: 'preservation music',
        type: ActivityType.Streaming,
        url: 'https://example.test/stream',
      }],
      status: 'idle',
    });
    expect(mocks.spinner.succeed).toHaveBeenCalledAfter(setPresence);
    expect(mocks.spinner.succeed).toHaveBeenCalledWith('Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=application-id&scope=bot%20applications.commands&permissions=36700160');
  });

  it('omits an empty activity URL from presence', async () => {
    const commands = makeCommandSet();
    const config = makeConfig(true);
    const {client, handlers, setPresence} = makeClient();
    mocks.containerGetAll.mockReturnValue(commands);

    await new Bot(client as never, config as never).register();
    await invoke(handlers, 'ready');

    expect(setPresence).toHaveBeenCalledWith(expect.objectContaining({
      activities: [expect.objectContaining({url: undefined})],
    }));
  });

  it('routes client errors to console and Discord debug events to the debug logger', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {handlers} = await registerBot(true);
    const clientError = new Error('client failure');

    await invoke(handlers, 'error', clientError);
    await invoke(handlers, 'debug', 'gateway trace');

    expect(consoleError).toHaveBeenCalledWith(clientError);
    expect(mocks.debug).toHaveBeenCalledWith('gateway trace');
    consoleError.mockRestore();
  });
});

describe('guild onboarding', () => {
  it('creates guild settings, registers guild commands, and DMs the owner in guild mode', async () => {
    const commands = makeCommandSet();
    const {handlers} = await registerBot(false, commands);
    const ownerSend = vi.fn().mockResolvedValue(undefined);
    const guild = {
      fetchOwner: vi.fn().mockResolvedValue({send: ownerSend}),
      id: 'guild-new',
    };

    await invoke(handlers, 'guildCreate', guild);

    expect(mocks.settingUpsert).toHaveBeenCalledWith({
      create: {guildId: 'guild-new'},
      update: {},
      where: {guildId: 'guild-new'},
    });
    expect(mocks.restPut).toHaveBeenCalledWith('/applications/application-id/guilds/guild-new/commands', {
      body: commands.map(command => command.slashCommand.toJSON()),
    });
    expect(guild.fetchOwner).toHaveBeenCalledOnce();
    expect(ownerSend).toHaveBeenCalledWith(expect.stringContaining('https://github.com/museofficial/muse/wiki/Configuring-Bot-Permissions'));
  });

  it('skips guild command registration in global mode but still initializes and welcomes', async () => {
    const {handlers} = await registerBot(true);
    const ownerSend = vi.fn().mockResolvedValue(undefined);
    const guild = {
      fetchOwner: vi.fn().mockResolvedValue({send: ownerSend}),
      id: 'guild-global',
    };

    await invoke(handlers, 'guildCreate', guild);

    expect(mocks.settingUpsert).toHaveBeenCalledWith(expect.objectContaining({where: {guildId: 'guild-global'}}));
    expect(mocks.restPut).not.toHaveBeenCalled();
    expect(ownerSend).toHaveBeenCalledOnce();
  });
});

describe('interaction boundaries', () => {
  it('rejects chat-input commands used outside a guild', async () => {
    const command = makeCommand('play');
    const {handlers} = await registerBot(true, [command]);
    const interaction = makeInteraction('play', {guild: null});

    await invoke(handlers, 'interactionCreate', interaction);

    expect(interaction.reply).toHaveBeenCalledWith('🚫 ope: you can\'t use this bot in a DM');
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('ephemerally rejects a voice-required command when the caller is outside voice', async () => {
    const command = makeCommand('play', {requiresVC: true});
    const {handlers} = await registerBot(true, [command]);
    const interaction = makeInteraction('play');

    await invoke(handlers, 'interactionCreate', interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '🚫 ope: gotta be in a voice channel',
      ephemeral: true,
    });
    expect(command.execute).not.toHaveBeenCalled();
  });

  it('allows a voice-required command when the caller is in any guild voice channel', async () => {
    const command = makeCommand('play', {requiresVC: true});
    const {handlers} = await registerBot(true, [command]);
    const members = new Collection([['member-id', {id: 'member-id'}]]);
    const guild = {
      channels: {
        cache: new Collection([['voice-id', {members, type: ChannelType.GuildVoice}]]),
      },
    };
    const interaction = makeInteraction('play', {guild});

    await invoke(handlers, 'interactionCreate', interaction);

    expect(command.execute).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('evaluates conditional voice guards and leaves non-voice actions available', async () => {
    const command = makeCommand('favorites', {
      requiresVC: interaction => interaction.options.getSubcommand() === 'use',
    });
    const {handlers} = await registerBot(true, [command]);
    const list = makeInteraction('favorites');
    const use = makeInteraction('favorites', {options: {getSubcommand: () => 'use'}});

    await invoke(handlers, 'interactionCreate', list);
    await invoke(handlers, 'interactionCreate', use);

    expect(command.execute).toHaveBeenCalledOnce();
    expect(command.execute).toHaveBeenCalledWith(list);
    expect(use.reply).toHaveBeenCalledWith({
      content: '🚫 ope: gotta be in a voice channel',
      ephemeral: true,
    });
  });

  it('debug-logs command failures and sends a fresh ephemeral error response', async () => {
    const failure = new Error('command failure');
    const command = makeCommand('play', {execute: vi.fn().mockRejectedValue(failure)});
    const {handlers} = await registerBot(true, [command]);
    const interaction = makeInteraction('play');

    await invoke(handlers, 'interactionCreate', interaction);

    expect(mocks.debug).toHaveBeenCalledWith(failure);
    expect(interaction.reply).toHaveBeenCalledWith({content: '🚫 ope: command failure', ephemeral: true});
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('edits deferred failures and swallows a failed error response', async () => {
    const command = makeCommand('play', {execute: vi.fn().mockRejectedValue(new Error('command failure'))});
    const {handlers} = await registerBot(true, [command]);
    const interaction = makeInteraction('play', {
      deferred: true,
      editReply: vi.fn().mockRejectedValue(new Error('message deleted')),
    });

    await expect(invoke(handlers, 'interactionCreate', interaction)).resolves.toBeUndefined();

    expect(interaction.editReply).toHaveBeenCalledWith('🚫 ope: command failure');
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('per-guild Player isolation', () => {
  it('reuses one Player within a guild and creates a separate Player for another guild', async () => {
    const fileCache = {kind: 'fake cache'};
    const youtubeAPI = {findAudioFallback: vi.fn().mockResolvedValue({title: 'fallback'})};
    const manager = new PlayerManager(fileCache as never, youtubeAPI as never);

    const guildA = manager.get('guild-a');
    const guildAAgain = manager.get('guild-a');
    const guildB = manager.get('guild-b');

    expect(guildAAgain).toBe(guildA);
    expect(guildB).not.toBe(guildA);
    expect(mocks.playerConstructions.map(player => player.guildId)).toEqual(['guild-a', 'guild-b']);
    expect(mocks.playerConstructions.every(player => player.fileCache === fileCache)).toBe(true);

    const song = {title: 'restricted'};
    await mocks.playerConstructions[0].findAudioFallback(song);
    expect(youtubeAPI.findAudioFallback).toHaveBeenCalledWith(song);
  });
});
