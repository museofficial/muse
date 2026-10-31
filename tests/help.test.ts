import 'reflect-metadata';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import type {Client} from 'discord.js';
import type Command from '../src/commands/index.js';

const mocks = vi.hoisted(() => ({
  clientOptions: undefined as unknown,
  login: vi.fn().mockResolvedValue(undefined),
  put: vi.fn().mockResolvedValue(undefined),
}));

// Exercise the real container and command constructors without loading .env,
// opening a database, or connecting to Discord or a media provider.
vi.mock('../src/services/config.js', () => ({
  DATA_DIR: '/unused-help-test',
  default: class {
    DISCORD_TOKEN = 'synthetic-token';
    YOUTUBE_API_KEY = 'synthetic-key';
    SPOTIFY_CLIENT_ID = '';
    SPOTIFY_CLIENT_SECRET = '';
    REGISTER_COMMANDS_ON_BOT = true;
    ENABLE_SPONSORBLOCK = false;
    SPONSORBLOCK_TIMEOUT = 5;
    BOT_STATUS = 'online';
    BOT_ACTIVITY_TYPE = 2;
    BOT_ACTIVITY = 'music';
    BOT_ACTIVITY_URL = '';
  },
}));

vi.mock('../src/utils/db.js', () => ({prisma: {
  $transaction: async (run: (transaction: object) => Promise<unknown>) => run({
    listeningSession: {findMany: async () => []},
  }),
}}));

vi.mock('discord.js', async () => {
  const actual = await vi.importActual<typeof import('discord.js')>('discord.js');
  const {EventEmitter} = await import('node:events');
  return {
    ...actual,
    Client: class extends EventEmitter {
      options = {};
      guilds = {cache: new actual.Collection()};
      user = {id: 'application-id', setPresence: vi.fn()};
      login = mocks.login;
      destroy = vi.fn();

      constructor(options: unknown) {
        super();
        mocks.clientOptions = options;
      }
    },
  };
});

vi.mock('@discordjs/rest', () => ({
  REST: class {
    setToken() {
      return this;
    }

    put = mocks.put;
  },
}));

vi.mock('@discordjs/voice', async () => ({
  ...await vi.importActual<typeof import('@discordjs/voice')>('@discordjs/voice'),
  generateDependencyReport: () => 'offline help test',
}));

vi.mock('ora', () => ({
  default: () => ({start() {return this;}, succeed: vi.fn()}),
}));

import container from '../src/inversify.config.js';
import {TYPES} from '../src/types.js';
import Bot from '../src/bot.js';
import Help from '../src/commands/help.js';

let commands: Command[];
let client: Client;

beforeAll(async () => {
  commands = container.getAll<Command>(TYPES.Command);
  client = container.get<Client>(TYPES.Client);
  await container.get<Bot>(TYPES.Bot).register();
  await client.listeners('ready')[0](client);
});

describe('/help integration', () => {
  it('creates the Discord client so replies can only ping individual users', () => {
    expect(mocks.clientOptions).toMatchObject({allowedMentions: {parse: ['users']}});
  });

  it('binds help as a singleton and registers it with the complete command set', () => {
    const help = commands.filter(command => command.slashCommand.name === 'help');
    expect(help).toHaveLength(1);
    expect(help[0]).toBeInstanceOf(Help);
    expect(container.getAll<Command>(TYPES.Command)).toContain(help[0]);
    expect(mocks.login).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledWith('/applications/application-id/commands', {
      body: commands.map(command => command.slashCommand.toJSON()),
    });
  });

  it('routes help without a voice channel and privately lists every registered command within Discord limits', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      commandName: 'help',
      guild: {id: 'guild-id'},
      member: {user: {id: 'user-id'}},
      isCommand: () => true,
      isButton: () => false,
      isChatInputCommand: () => true,
      reply,
    };

    await client.listeners('interactionCreate')[0](interaction);

    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0][0] as {content: string; ephemeral: boolean};
    expect(payload.ephemeral).toBe(true);
    expect(payload.content.length).toBeGreaterThan(0);
    expect(payload.content.length).toBeLessThanOrEqual(2000);
    for (const command of commands) {
      expect(payload.content).toContain(`**/${command.slashCommand.name}** — ${command.slashCommand.description}`);
    }
    expect(payload.content).toContain('Your confirmation is private');
    expect(payload.content).toContain('View full history');
    expect(payload.content).toContain('named search or track/playlist URL for this server');
    expect(payload.content).toContain('not audio or a copy of the queue');
    expect(payload.content).toContain('/favorites create name:lofi query:lofi hip hop');
    expect(payload.content).toContain('/favorites use name:lofi');
    expect(payload.content).toContain('waits 60 seconds');
    expect(payload.content).toContain('delay:0');
    expect(payload.content).toContain('separate setting');
  });

  it('includes the missing usage details in native slash-command descriptions', () => {
    const favorites = commands.find(command => command.slashCommand.name === 'favorites')!.slashCommand.toJSON();
    expect(favorites.description).toContain('named searches or URLs for this server');
    const config = commands.find(command => command.slashCommand.name === 'config')!.slashCommand.toJSON();
    const wait = config.options!.find(option => option.name === 'set-wait-after-queue-empties')!;
    expect(wait.description).toContain('seconds');
    expect(wait.description).toContain('0 to never leave');
  });
});
