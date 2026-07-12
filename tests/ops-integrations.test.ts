import 'reflect-metadata';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  createAudioPlayer: vi.fn(),
  createAudioResource: vi.fn(),
  debug: vi.fn(),
  entersState: vi.fn(),
  execa: vi.fn(),
  ffmpeg: vi.fn(),
  getGuildSettings: vi.fn(),
  joinVoiceChannel: vi.fn(),
  sleep: vi.fn(),
  spotifyClientCredentialsGrant: vi.fn(),
  spotifyConstructorOptions: [] as unknown[],
  spotifySetAccessToken: vi.fn(),
}));

vi.mock('@discordjs/voice', () => ({
  AudioPlayerStatus: {Idle: 'idle'},
  VoiceConnectionDisconnectReason: {WebSocketClose: 'websocket-close'},
  VoiceConnectionStatus: {
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
    Ready: 'ready',
    Signalling: 'signalling',
  },
  StreamType: {WebmOpus: 'webm-opus'},
  createAudioPlayer: dependencyMocks.createAudioPlayer,
  createAudioResource: dependencyMocks.createAudioResource,
  entersState: dependencyMocks.entersState,
  joinVoiceChannel: dependencyMocks.joinVoiceChannel,
}));

vi.mock('timers/promises', () => ({
  setTimeout: dependencyMocks.sleep,
}));

vi.mock('execa', () => ({
  execa: dependencyMocks.execa,
}));

vi.mock('fluent-ffmpeg', () => ({
  default: dependencyMocks.ffmpeg,
}));

vi.mock('spotify-web-api-node', () => ({
  default: class {
    clientCredentialsGrant = dependencyMocks.spotifyClientCredentialsGrant;
    setAccessToken = dependencyMocks.spotifySetAccessToken;

    constructor(options: unknown) {
      dependencyMocks.spotifyConstructorOptions.push(options);
    }
  },
}));

vi.mock('../src/services/file-cache.js', () => ({
  default: class {},
}));

vi.mock('../src/utils/build-embed.js', () => ({
  buildPlayingMessageEmbed: vi.fn(() => ({title: 'playing'})),
}));

vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: dependencyMocks.getGuildSettings,
}));

vi.mock('../src/utils/debug.js', () => ({
  default: dependencyMocks.debug,
}));

import Player, {MediaSource, QueuedSong} from '../src/services/player.js';
import ThirdParty from '../src/services/third-party.js';
import prepareYtDlp from '../src/utils/prepare-yt-dlp.js';
import {getExecutable, getYouTubeMediaSource, getYtDlpVersion, updateYtDlp} from '../src/utils/yt-dlp.js';

const GUILD_ID = 'guild-id';
const ORIGINAL_ENV = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  MUSE_BUNDLED_YT_DLP_PATH: process.env.MUSE_BUNDLED_YT_DLP_PATH,
  PATH: process.env.PATH,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  YT_DLP_COOKIES_PATH: process.env.YT_DLP_COOKIES_PATH,
  YT_DLP_PATH: process.env.YT_DLP_PATH,
};
const VALID_MEDIA_RESPONSE = JSON.stringify({
  requested_downloads: [{
    url: 'https://media.example/requested.webm',
    http_headers: {
      Authorization: 'Bearer media-token',
      'User-Agent': 'Muse ops test',
      Empty: '',
      Missing: null,
    },
  }],
  http_headers: {'X-Fallback': 'not-used'},
  is_live: true,
});

const makeDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {promise, reject, resolve};
};

const flushAsyncWork = async () => {
  for (let index = 0; index < 12; index++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

const makeFfmpegCommand = () => {
  const command = {
    audioCodec: vi.fn(() => command),
    inputOptions: vi.fn(() => command),
    kill: vi.fn(),
    noVideo: vi.fn(() => command),
    on: vi.fn(() => command),
    outputFormat: vi.fn(() => command),
    pipe: vi.fn((destination: {end(): void}) => {
      destination.end();
      return destination;
    }),
  };

  return command;
};

const makeExecutableLayout = async (includePython = true) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'muse-ops-yt-dlp-'));
  const bin = path.join(root, 'bin');
  const executable = path.join(bin, 'yt-dlp');
  const python = path.join(bin, 'python');
  await fs.mkdir(bin);
  await fs.writeFile(executable, '#!/bin/sh\n', {mode: 0o755});
  if (includePython) {
    await fs.writeFile(python, '#!/bin/sh\n', {mode: 0o755});
  }

  return {executable, python, root};
};

const loadSpotifyBindingHarness = async (clientId: string, clientSecret: string) => {
  vi.resetModules();
  process.env.DISCORD_TOKEN = 'synthetic-discord-token';
  process.env.YOUTUBE_API_KEY = 'synthetic-youtube-key';
  process.env.SPOTIFY_CLIENT_ID = clientId;
  process.env.SPOTIFY_CLIENT_SECRET = clientSecret;
  vi.doMock('discord.js', async () => {
    const actual = await vi.importActual<typeof import('discord.js')>('discord.js');

    return {
      ...actual,
      Client: class {},
    };
  });

  const [{default: container}, {TYPES}, {default: Play}] = await Promise.all([
    import('../src/inversify.config.js'),
    import('../src/types.js'),
    import('../src/commands/play.js'),
  ]);

  return {container, Play, TYPES};
};

const makeVoiceConnection = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const connection = {
    destroy: vi.fn(),
    joinConfig: {channelId: 'voice-channel-id'},
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return connection;
    }),
    receiver: {speaking: {on: vi.fn()}},
    rejoin: vi.fn(() => true),
    rejoinAttempts: 0,
    state: {status: 'ready'},
    subscribe: vi.fn(),
    ...overrides,
  };

  return {connection, handlers};
};

const getPrivatePlayer = (player: Player) => player as unknown as {
  onVoiceConnectionDisconnect(connection: object): Promise<void>;
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.spotifyConstructorOptions.length = 0;
  delete process.env.YT_DLP_COOKIES_PATH;
  delete process.env.YT_DLP_PATH;
  delete process.env.MUSE_BUNDLED_YT_DLP_PATH;
  dependencyMocks.execa.mockResolvedValue({stdout: VALID_MEDIA_RESPONSE});
  dependencyMocks.ffmpeg.mockImplementation(makeFfmpegCommand);
  dependencyMocks.getGuildSettings.mockResolvedValue({
    defaultVolume: 100,
    turnDownVolumeWhenPeopleSpeak: false,
  });
  dependencyMocks.entersState.mockResolvedValue(undefined);
  dependencyMocks.sleep.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();

  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('OPS-10 yt-dlp selection and update lifecycle', () => {
  it('prefers YT_DLP_PATH and reports the trimmed installed version when auto-update is disabled', async () => {
    process.env.YT_DLP_PATH = '/configured/yt-dlp';
    process.env.MUSE_BUNDLED_YT_DLP_PATH = '/bundled/yt-dlp';
    process.env.PATH = '/path/that/would/otherwise/be/searched';
    dependencyMocks.execa.mockResolvedValue({stdout: ' 2026.07.12 \n'});
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(getExecutable()).toBe('/configured/yt-dlp');
    await expect(getYtDlpVersion()).resolves.toBe('2026.07.12');
    await prepareYtDlp({YT_DLP_AUTO_UPDATE: false} as never);

    expect(dependencyMocks.execa).toHaveBeenCalledWith('/configured/yt-dlp', ['--version'], {
      timeout: 15_000,
    });
    expect(log).toHaveBeenCalledWith('YT_DLP_VERSION=2026.07.12 (/configured/yt-dlp)');
  });

  it('falls back from a blank configured path to the bundled executable and then the PATH command', () => {
    process.env.YT_DLP_PATH = '   ';
    process.env.MUSE_BUNDLED_YT_DLP_PATH = ' /bundled/yt-dlp ';
    expect(getExecutable()).toBe('/bundled/yt-dlp');

    delete process.env.MUSE_BUNDLED_YT_DLP_PATH;
    expect(getExecutable()).toBe('yt-dlp');
  });

  it('prefers pip through the executable sibling virtualenv and re-probes the updated version', async () => {
    const layout = await makeExecutableLayout();
    const pythonExecutable = await fs.realpath(layout.python);
    process.env.YT_DLP_PATH = layout.executable;
    const versions = ['2026.01.01', '2026.07.12'];
    dependencyMocks.execa.mockImplementation(async (executable: string, args: string[]) => {
      if (args[0] === '--version') {
        return {stdout: versions.shift()!};
      }

      if (executable === pythonExecutable) {
        return {stdout: ''};
      }

      throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
    });

    try {
      await expect(updateYtDlp()).resolves.toEqual({
        beforeVersion: '2026.01.01',
        afterVersion: '2026.07.12',
        updated: true,
        skipped: false,
        updateSucceeded: true,
        error: undefined,
      });
      expect(dependencyMocks.execa).toHaveBeenNthCalledWith(2, pythonExecutable, [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '--upgrade',
        'yt-dlp[default]',
      ], {
        env: {
          PIP_DISABLE_PIP_VERSION_CHECK: '1',
          PIP_NO_INPUT: '1',
        },
        timeout: 120_000,
      });
      expect(dependencyMocks.execa.mock.calls.some(([, args]) => (args as string[])[0] === '-U')).toBe(false);
      expect(dependencyMocks.execa).toHaveBeenLastCalledWith(layout.executable, ['--version'], {
        timeout: 15_000,
      });
    } finally {
      await fs.rm(layout.root, {recursive: true, force: true});
    }
  });

  it('falls back to self-update when sibling-venv pip fails and still re-probes', async () => {
    const layout = await makeExecutableLayout();
    const pythonExecutable = await fs.realpath(layout.python);
    process.env.YT_DLP_PATH = layout.executable;
    const versions = ['2026.01.01', '2026.07.12'];
    dependencyMocks.execa.mockImplementation(async (executable: string, args: string[]) => {
      if (args[0] === '--version') {
        return {stdout: versions.shift()!};
      }

      if (executable === pythonExecutable) {
        throw {stderr: 'pip update failed'};
      }

      if (executable === layout.executable && args[0] === '-U') {
        return {stdout: ''};
      }

      throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
    });

    try {
      await expect(updateYtDlp()).resolves.toMatchObject({
        beforeVersion: '2026.01.01',
        afterVersion: '2026.07.12',
        updated: true,
        updateSucceeded: true,
      });
      expect(dependencyMocks.execa).toHaveBeenCalledWith(layout.executable, ['-U'], {
        timeout: 120_000,
      });
      expect(dependencyMocks.execa).toHaveBeenLastCalledWith(layout.executable, ['--version'], {
        timeout: 15_000,
      });
    } finally {
      await fs.rm(layout.root, {recursive: true, force: true});
    }
  });

  it('keeps an installed version nonfatal after both update mechanisms fail', async () => {
    const layout = await makeExecutableLayout();
    const pythonExecutable = await fs.realpath(layout.python);
    process.env.YT_DLP_PATH = layout.executable;
    dependencyMocks.execa.mockImplementation(async (executable: string, args: string[]) => {
      if (args[0] === '--version') {
        return {stdout: '2026.01.01'};
      }

      if (executable === pythonExecutable) {
        throw {stderr: 'pip update failed'};
      }

      if (args[0] === '-U') {
        throw {stderr: 'self update failed'};
      }

      throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(prepareYtDlp({YT_DLP_AUTO_UPDATE: true} as never)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('yt-dlp update warning: pip update failed; self update failed');
      expect(log).toHaveBeenCalledWith(
        'YT_DLP_VERSION=2026.01.01 (update failed; continuing with installed version)',
      );
      expect(dependencyMocks.execa.mock.calls.filter(([, args]) => (args as string[])[0] === '--version')).toHaveLength(2);
    } finally {
      await fs.rm(layout.root, {recursive: true, force: true});
    }
  });
});

describe('OPS-11 yt-dlp extraction and ffmpeg handoff', () => {
  it('uses the bounded single-video Node-runtime extraction contract and normalizes the selected download', async () => {
    process.env.YT_DLP_PATH = '/fake/yt-dlp';

    await expect(getYouTubeMediaSource('abcdefghijk')).resolves.toEqual({
      url: 'https://media.example/requested.webm',
      headers: {
        Authorization: 'Bearer media-token',
        'User-Agent': 'Muse ops test',
      },
      isLive: true,
    });
    expect(dependencyMocks.execa).toHaveBeenCalledWith('/fake/yt-dlp', [
      '--dump-single-json',
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '--no-cache-dir',
      '--js-runtimes',
      'node',
      '-f',
      'bestaudio/best',
      '-S',
      'proto:https',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ], {
      timeout: 45_000,
    });
  });

  it('hands reconnect and CRLF-normalized headers to ffmpeg', async () => {
    process.env.YT_DLP_PATH = '/fake/yt-dlp';
    const fileCache = {
      getPathFor: vi.fn().mockResolvedValue(null),
    };
    const player = new Player(fileCache as never, GUILD_ID);
    const song: QueuedSong = {
      title: 'Long uncached track',
      artist: 'Artist',
      url: 'abcdefghijk',
      length: 3_600,
      offset: 0,
      playlist: null,
      isLive: false,
      thumbnailUrl: null,
      source: MediaSource.Youtube,
      addedInChannelId: 'text-channel-id',
      requestedBy: 'requester-id',
    };

    const stream = await (player as unknown as {
      getStream(input: QueuedSong): Promise<Readable>;
    }).getStream(song);
    const command = dependencyMocks.ffmpeg.mock.results[0].value as ReturnType<typeof makeFfmpegCommand>;

    expect(dependencyMocks.ffmpeg).toHaveBeenCalledWith('https://media.example/requested.webm');
    expect(command.inputOptions).toHaveBeenCalledWith([
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-headers',
      'Authorization: Bearer media-token\r\nUser-Agent: Muse ops test\r\n',
    ]);
    expect(command.noVideo).toHaveBeenCalledOnce();
    expect(command.audioCodec).toHaveBeenCalledWith('libopus');
    expect(command.outputFormat).toHaveBeenCalledWith('webm');

    stream.destroy();
    await flushAsyncWork();
  });
});

describe('OPS-12 optional Spotify bindings', () => {
  it('binds both Spotify services and advertises Spotify only when both credentials are nonblank', async () => {
    const {container, Play, TYPES} = await loadSpotifyBindingHarness(' client-id ', ' client-secret ');
    const command = new Play({spotify: {}} as never, {} as never, {} as never);
    const queryOption = command.slashCommand.toJSON().options?.find(option => option.name === 'query');

    expect(container.isBound(TYPES.Services.SpotifyAPI)).toBe(true);
    expect(container.isBound(TYPES.ThirdParty)).toBe(true);
    expect(container.isBound(TYPES.Services.YoutubeAPI)).toBe(true);
    expect(container.isBound(TYPES.Services.GetSongs)).toBe(true);
    expect(queryOption?.description).toBe('YouTube URL, Spotify URL, or search query');
  });

  it.each([
    ['', 'client-secret', 'missing ID'],
    ['client-id', '', 'missing secret'],
    ['   ', 'client-secret', 'blank ID'],
    ['client-id', ' \t ', 'blank secret'],
  ])('keeps core YouTube services and description when credentials have %s / %s (%s)', async (
    clientId,
    clientSecret,
  ) => {
    const {container, Play, TYPES} = await loadSpotifyBindingHarness(clientId, clientSecret);
    const command = new Play(undefined as never, {} as never, {} as never);
    const queryOption = command.slashCommand.toJSON().options?.find(option => option.name === 'query');

    expect(container.isBound(TYPES.Services.SpotifyAPI)).toBe(false);
    expect(container.isBound(TYPES.ThirdParty)).toBe(false);
    expect(container.isBound(TYPES.Services.YoutubeAPI)).toBe(true);
    expect(container.isBound(TYPES.Services.GetSongs)).toBe(true);
    expect(queryOption?.description).toBe('YouTube URL or search query');
  });
});

describe('OPS-12 Spotify token lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('installs the token, refreshes at half-life, and cleans up the pending timer', async () => {
    dependencyMocks.spotifyClientCredentialsGrant
      .mockResolvedValueOnce({body: {access_token: 'token-one', expires_in: 120}})
      .mockResolvedValueOnce({body: {access_token: 'token-two', expires_in: 240}});
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const service = new ThirdParty({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
    } as never);
    await flushAsyncWork();

    expect(dependencyMocks.spotifyConstructorOptions).toEqual([{
      clientId: 'client-id',
      clientSecret: 'client-secret',
    }]);
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenNthCalledWith(1, 'token-one');
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsyncWork();

    expect(dependencyMocks.spotifyClientCredentialsGrant).toHaveBeenCalledTimes(2);
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenNthCalledWith(2, 'token-two');
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 120_000);
    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds credential-grant retry to five retries before a successful sixth attempt', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      dependencyMocks.spotifyClientCredentialsGrant.mockRejectedValueOnce(new Error(`attempt ${attempt + 1}`));
    }

    dependencyMocks.spotifyClientCredentialsGrant.mockResolvedValueOnce({
      body: {access_token: 'eventual-token', expires_in: 120},
    });
    const service = new ThirdParty({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
    } as never);
    await flushAsyncWork();

    await vi.advanceTimersByTimeAsync(31_000);
    await flushAsyncWork();

    expect(dependencyMocks.spotifyClientCredentialsGrant).toHaveBeenCalledTimes(6);
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenCalledOnce();
    expect(dependencyMocks.spotifySetAccessToken).toHaveBeenCalledWith('eventual-token');
    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs exhausted refresh failure and reschedules one attempt after 60 seconds', async () => {
    dependencyMocks.spotifyClientCredentialsGrant.mockRejectedValue(new Error('Spotify auth unavailable'));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const service = new ThirdParty({
      SPOTIFY_CLIENT_ID: 'client-id',
      SPOTIFY_CLIENT_SECRET: 'client-secret',
    } as never);
    await flushAsyncWork();

    await vi.advanceTimersByTimeAsync(31_000);
    await flushAsyncWork();

    expect(dependencyMocks.spotifyClientCredentialsGrant).toHaveBeenCalledTimes(6);
    expect(dependencyMocks.spotifySetAccessToken).not.toHaveBeenCalled();
    expect(dependencyMocks.debug).toHaveBeenCalledWith(
      'Spotify token refresh failed: %O',
      expect.objectContaining({message: 'Spotify auth unavailable'}),
    );
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    expect(vi.getTimerCount()).toBe(1);

    service.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('OPS-13 transient voice recovery', () => {
  it.each(['connecting', 'signalling'])('keeps a 4014 connection when it recovers through %s', async recoveredStatus => {
    const never = new Promise<void>(() => undefined);
    dependencyMocks.entersState.mockImplementation(async (_connection, status: string) => (
      status === recoveredStatus ? undefined : never
    ));
    const {connection} = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'connecting', 5_000);
    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'signalling', 5_000);
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connection);
  });

  it('destroys a 4014 connection when both five-second recovery waits time out', async () => {
    dependencyMocks.entersState.mockRejectedValue(new Error('recovery timed out'));
    const {connection} = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'connecting', 5_000);
    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'signalling', 5_000);
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('does not disconnect a replacement when an old 4014 recovery wait later times out', async () => {
    const oldRecovery = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(oldRecovery.promise);
    const {connection: oldConnection} = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const {connection: replacement} = makeVoiceConnection({
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = oldConnection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);
    await flushAsyncWork();
    player.voiceConnection = replacement as never;
    oldRecovery.reject(new Error('old 4014 recovery timed out'));
    await recovery;

    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement);
  });

  it('cleans up an old 4014 connection that recovers after it was replaced', async () => {
    const oldRecovery = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(oldRecovery.promise);
    const {connection: oldConnection} = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const {connection: replacement} = makeVoiceConnection({
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = oldConnection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);
    await flushAsyncWork();
    player.voiceConnection = replacement as never;
    oldRecovery.resolve(undefined);
    await recovery;

    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement);
  });

  it('does not destroy an already Destroyed stale connection or touch its replacement', async () => {
    const {connection: oldConnection} = makeVoiceConnection({
      state: {status: 'destroyed'},
    });
    const {connection: replacement} = makeVoiceConnection({
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = replacement as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);

    expect(oldConnection.destroy).not.toHaveBeenCalled();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement);
  });

  it('backs off in five-second increments and rejoins below five attempts', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const {connection} = makeVoiceConnection({
      rejoinAttempts: 2,
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    expect(dependencyMocks.sleep).toHaveBeenCalledWith(15_000);
    backoff.resolve(undefined);
    await recovery;

    expect(connection.rejoin).toHaveBeenCalledOnce();
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connection);
  });

  it('does not destroy a connection that becomes Ready during disconnect backoff', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const {connection} = makeVoiceConnection({
      rejoinAttempts: 1,
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    expect(dependencyMocks.sleep).toHaveBeenCalledWith(10_000);

    connection.state.status = 'ready';
    backoff.resolve(undefined);
    await recovery;

    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connection);
  });

  it('clears a current connection that becomes Destroyed during transient backoff without destroying it again', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const {connection} = makeVoiceConnection({
      rejoinAttempts: 1,
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    const audioPlayer = {stop: vi.fn()};
    player.voiceConnection = connection as never;
    Object.assign(player, {
      audioPlayer,
      audioResource: {volume: {}},
      currentChannel: {id: 'old-channel'},
    });

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    connection.state.status = 'destroyed';
    backoff.resolve(undefined);
    await recovery;

    const state = player as unknown as {
      audioPlayer: object | null;
      audioResource: object | null;
      currentChannel?: object;
    };
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(audioPlayer.stop).toHaveBeenCalledWith(true);
    expect(player.voiceConnection).toBeNull();
    expect(state.audioPlayer).toBeNull();
    expect(state.audioResource).toBeNull();
    expect(state.currentChannel).toBeUndefined();
  });

  it('does not rejoin or destroy a replacement when an old transient backoff later releases', async () => {
    const backoff = makeDeferred<void>();
    dependencyMocks.sleep.mockReturnValue(backoff.promise);
    const {connection: oldConnection} = makeVoiceConnection({
      rejoinAttempts: 1,
      state: {status: 'disconnected'},
    });
    const {connection: replacement} = makeVoiceConnection({
      rejoinAttempts: 0,
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = oldConnection as never;

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(oldConnection);
    expect(dependencyMocks.sleep).toHaveBeenCalledWith(10_000);
    player.voiceConnection = replacement as never;
    backoff.resolve(undefined);
    await recovery;

    expect(oldConnection.rejoin).not.toHaveBeenCalled();
    expect(oldConnection.destroy).toHaveBeenCalledOnce();
    expect(replacement.rejoin).not.toHaveBeenCalled();
    expect(replacement.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(replacement);
  });

  it('clears a current 4014 connection already Destroyed when its recovery wait rejects', async () => {
    const oldRecovery = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(oldRecovery.promise);
    const {connection} = makeVoiceConnection({
      state: {
        status: 'disconnected',
        reason: 'websocket-close',
        closeCode: 4014,
      },
    });
    const player = new Player({} as never, GUILD_ID);
    const audioPlayer = {stop: vi.fn()};
    player.voiceConnection = connection as never;
    Object.assign(player, {
      audioPlayer,
      audioResource: {volume: {}},
      currentChannel: {id: 'old-channel'},
    });

    const recovery = getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);
    await flushAsyncWork();
    connection.state.status = 'destroyed';
    oldRecovery.reject(new Error('4014 recovery ended after destruction'));
    await recovery;

    const state = player as unknown as {
      audioPlayer: object | null;
      audioResource: object | null;
      currentChannel?: object;
    };
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(audioPlayer.stop).toHaveBeenCalledWith(true);
    expect(player.voiceConnection).toBeNull();
    expect(state.audioPlayer).toBeNull();
    expect(state.audioResource).toBeNull();
    expect(state.currentChannel).toBeUndefined();
  });

  it('destroys a still-disconnected connection when rejoin fails below five attempts', async () => {
    const {connection} = makeVoiceConnection({
      rejoin: vi.fn(() => false),
      rejoinAttempts: 0,
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.sleep).toHaveBeenCalledWith(5_000);
    expect(connection.rejoin).toHaveBeenCalledOnce();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('destroys immediately when rejoin attempts are exhausted', async () => {
    const {connection} = makeVoiceConnection({
      rejoinAttempts: 5,
      state: {status: 'disconnected'},
    });
    const player = new Player({} as never, GUILD_ID);
    player.voiceConnection = connection as never;

    await getPrivatePlayer(player).onVoiceConnectionDisconnect(connection);

    expect(dependencyMocks.sleep).not.toHaveBeenCalled();
    expect(connection.rejoin).not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });

  it('keeps a newer connection when an older initial Ready wait rejects and ignores the old Ready callback', async () => {
    const readyA = makeDeferred<void>();
    const readyB = makeDeferred<void>();
    const {connection: connectionA, handlers: handlersA} = makeVoiceConnection({
      rejoinAttempts: 2,
      state: {status: 'connecting'},
    });
    const {connection: connectionB} = makeVoiceConnection({
      state: {status: 'connecting'},
    });
    dependencyMocks.joinVoiceChannel
      .mockReturnValueOnce(connectionA)
      .mockReturnValueOnce(connectionB);
    dependencyMocks.entersState.mockImplementation((_connection: unknown) => (
      _connection === connectionA ? readyA.promise : readyB.promise
    ));
    const player = new Player({} as never, GUILD_ID);
    const registerVoiceActivityListener = vi.spyOn(player, 'registerVoiceActivityListener');
    const channelA = {
      id: 'voice-channel-a',
      guild: {id: GUILD_ID, voiceAdapterCreator: {}},
    };
    const channelB = {
      id: 'voice-channel-b',
      guild: {id: GUILD_ID, voiceAdapterCreator: {}},
    };

    const connectingA = player.connect(channelA as never);
    await flushAsyncWork();
    const connectingB = player.connect(channelB as never);
    await flushAsyncWork();
    expect(player.voiceConnection).toBe(connectionB);

    handlersA.get('stateChange')!({status: 'connecting'}, {status: 'ready'});
    connectionA.state.status = 'disconnected';
    readyA.reject(new Error('connection A Ready timeout'));
    await expect(connectingA).rejects.toThrow(
      'Failed to connect to the voice channel (last state: disconnected, rejoin attempts: 2, recent states: connecting -> ready).',
    );

    readyB.resolve(undefined);
    await connectingB;

    expect(connectionA.destroy).toHaveBeenCalled();
    expect(connectionB.destroy).not.toHaveBeenCalled();
    expect(player.voiceConnection).toBe(connectionB);
    expect(registerVoiceActivityListener).not.toHaveBeenCalled();
  });

  it('uses a 60-second initial Ready wait and preserves status, attempts, and recent-state diagnostics', async () => {
    const ready = makeDeferred<void>();
    dependencyMocks.entersState.mockReturnValue(ready.promise);
    const {connection, handlers} = makeVoiceConnection({
      rejoinAttempts: 3,
      state: {status: 'connecting'},
    });
    dependencyMocks.joinVoiceChannel.mockReturnValue(connection);
    const player = new Player({} as never, GUILD_ID);
    const channel = {
      id: 'voice-channel-id',
      guild: {
        id: GUILD_ID,
        voiceAdapterCreator: {},
      },
    };

    const connecting = player.connect(channel as never);
    await flushAsyncWork();
    expect(dependencyMocks.entersState).toHaveBeenCalledWith(connection, 'ready', 60_000);

    handlers.get('stateChange')!({status: 'connecting'}, {status: 'signalling'});
    handlers.get('stateChange')!({status: 'signalling'}, {status: 'disconnected'});
    connection.state.status = 'disconnected';
    ready.reject(new Error('initial Ready timeout'));

    await expect(connecting).rejects.toThrow(
      'Failed to connect to the voice channel (last state: disconnected, rejoin attempts: 3, recent states: connecting -> signalling -> disconnected).',
    );
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(player.voiceConnection).toBeNull();
  });
});
