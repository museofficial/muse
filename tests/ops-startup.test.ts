import {promises as fs} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const CONFIG_ENV_KEYS = [
  'BOT_ACTIVITY',
  'BOT_ACTIVITY_TYPE',
  'BOT_ACTIVITY_URL',
  'BOT_STATUS',
  'CACHE_LIMIT',
  'DATA_DIR',
  'DISCORD_TOKEN',
  'ENABLE_SPONSORBLOCK',
  'ENV_FILE',
  'MUSE_BUNDLED_YT_DLP_PATH',
  'REGISTER_COMMANDS_ON_BOT',
  'SPONSORBLOCK_TIMEOUT',
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_CLIENT_SECRET',
  'YOUTUBE_API_KEY',
  'YT_DLP_AUTO_UPDATE',
  'YT_DLP_PATH',
] as const;

const originalCwd = process.cwd();
const originalEnv = {...process.env};
let temporaryRoot: string;

const resetConfigEnvironment = () => {
  process.env = {...originalEnv};
  for (const key of CONFIG_ENV_KEYS) {
    delete process.env[key];
  }
};

const loadConfig = async (environment: NodeJS.ProcessEnv = {}) => {
  vi.resetModules();
  process.chdir(temporaryRoot);
  resetConfigEnvironment();
  Object.assign(process.env, environment);
  return import('../src/services/config.js');
};

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  resetConfigEnvironment();
  temporaryRoot = await fs.mkdtemp(path.join(tmpdir(), 'muse-ops-startup-'));
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = {...originalEnv};
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(temporaryRoot, {force: true, recursive: true});
});

describe('OPS-01 environment and config loading', () => {
  it('loads cwd/.env by default and honors an explicit ENV_FILE instead', async () => {
    const defaultEnvironmentFile = path.join(temporaryRoot, '.env');
    const explicitEnvironmentFile = path.join(temporaryRoot, 'operator.env');
    await fs.writeFile(defaultEnvironmentFile, [
      'DISCORD_TOKEN=default-token',
      'YOUTUBE_API_KEY=default-youtube-key',
      'DATA_DIR=./default-data',
      '',
    ].join('\n'));
    await fs.writeFile(explicitEnvironmentFile, [
      'DISCORD_TOKEN=explicit-token',
      'YOUTUBE_API_KEY=explicit-youtube-key',
      'DATA_DIR=./explicit-data',
      '',
    ].join('\n'));
    const defaultModule = await loadConfig();
    const defaultConfig = new defaultModule.default();
    const resolvedTemporaryRoot = process.cwd();
    expect(defaultConfig.DISCORD_TOKEN).toBe('default-token');
    expect(defaultConfig.YOUTUBE_API_KEY).toBe('default-youtube-key');
    expect(defaultConfig.DATA_DIR).toBe(path.join(resolvedTemporaryRoot, 'default-data'));

    const explicitModule = await loadConfig({ENV_FILE: explicitEnvironmentFile});
    const explicitConfig = new explicitModule.default();
    expect(explicitConfig.DISCORD_TOKEN).toBe('explicit-token');
    expect(explicitConfig.YOUTUBE_API_KEY).toBe('explicit-youtube-key');
    expect(explicitConfig.DATA_DIR).toBe(path.join(resolvedTemporaryRoot, 'explicit-data'));
  });

  it('trims required and optional string values', async () => {
    const {default: Config} = await loadConfig({
      BOT_ACTIVITY: '  preservation music  ',
      BOT_ACTIVITY_URL: '  https://example.test/activity  ',
      BOT_STATUS: '  idle  ',
      DISCORD_TOKEN: '  discord-secret  ',
      SPOTIFY_CLIENT_ID: '  spotify-client  ',
      SPOTIFY_CLIENT_SECRET: '  spotify-secret  ',
      YOUTUBE_API_KEY: '  youtube-secret  ',
    });

    const config = new Config();

    expect(config.DISCORD_TOKEN).toBe('discord-secret');
    expect(config.YOUTUBE_API_KEY).toBe('youtube-secret');
    expect(config.SPOTIFY_CLIENT_ID).toBe('spotify-client');
    expect(config.SPOTIFY_CLIENT_SECRET).toBe('spotify-secret');
    expect(config.BOT_STATUS).toBe('idle');
    expect(config.BOT_ACTIVITY_URL).toBe('https://example.test/activity');
    expect(config.BOT_ACTIVITY).toBe('preservation music');
  });

  it.each(['DISCORD_TOKEN', 'YOUTUBE_API_KEY'] as const)(
    'rejects a whitespace-only %s without logging its value',
    async requiredKey => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const exit = vi.spyOn(process, 'exit').mockImplementation(code => {
        throw new Error(`process.exit(${String(code)})`);
      });
      const environment = {
        DISCORD_TOKEN: 'discord-secret',
        YOUTUBE_API_KEY: 'youtube-secret',
        [requiredKey]: '   ',
      };
      const {default: Config} = await loadConfig(environment);

      expect(() => new Config()).toThrow('process.exit(1)');
      expect(exit).toHaveBeenCalledWith(1);
      expect(consoleError).toHaveBeenCalledWith(`Missing environment variable for ${requiredKey}`);
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('discord-secret');
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('youtube-secret');
    },
  );

  it.each(['DISCORD_TOKEN', 'YOUTUBE_API_KEY'] as const)(
    'rejects a missing %s without logging configured secret values',
    async requiredKey => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const exit = vi.spyOn(process, 'exit').mockImplementation(code => {
        throw new Error(`process.exit(${String(code)})`);
      });
      const environment: NodeJS.ProcessEnv = {
        DISCORD_TOKEN: 'discord-secret',
        YOUTUBE_API_KEY: 'youtube-secret',
      };
      delete environment[requiredKey];
      const {default: Config} = await loadConfig(environment);

      expect(() => new Config()).toThrow('process.exit(1)');
      expect(exit).toHaveBeenCalledWith(1);
      expect(consoleError).toHaveBeenCalledWith(`Missing environment variable for ${requiredKey}`);
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('discord-secret');
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('youtube-secret');
    },
  );

  it('requires literal true for booleans and accepts only finite numeric results', async () => {
    const {default: Config} = await loadConfig({
      DISCORD_TOKEN: 'discord-secret',
      ENABLE_SPONSORBLOCK: 'TRUE',
      REGISTER_COMMANDS_ON_BOT: 'true',
      SPONSORBLOCK_TIMEOUT: '17',
      YOUTUBE_API_KEY: 'youtube-secret',
      YT_DLP_AUTO_UPDATE: ' true ',
    });
    const config = new Config();

    expect(config.REGISTER_COMMANDS_ON_BOT).toBe(true);
    expect(config.ENABLE_SPONSORBLOCK).toBe(false);
    expect(config.YT_DLP_AUTO_UPDATE).toBe(false);
    expect(config.SPONSORBLOCK_TIMEOUT).toBe(17);

    const invalidModule = await loadConfig({
      DISCORD_TOKEN: 'discord-secret',
      SPONSORBLOCK_TIMEOUT: 'Infinity',
      YOUTUBE_API_KEY: 'youtube-secret',
    });
    expect(() => new invalidModule.default()).toThrow('Invalid numeric value for SPONSORBLOCK_TIMEOUT');
  });

  it('uses the default data/cache paths and two-gigabyte cache limit', async () => {
    const {default: Config, DATA_DIR} = await loadConfig({
      DISCORD_TOKEN: 'discord-secret',
      YOUTUBE_API_KEY: 'youtube-secret',
    });
    const config = new Config();
    const resolvedTemporaryRoot = await fs.realpath(temporaryRoot);
    const expectedDataDirectory = path.resolve(resolvedTemporaryRoot, 'data');

    expect(process.cwd()).toBe(resolvedTemporaryRoot);
    expect(process.cwd()).not.toBe(originalCwd);
    expect(DATA_DIR).toBe(expectedDataDirectory);
    expect(config.DATA_DIR).toBe(expectedDataDirectory);
    expect(config.CACHE_DIR).toBe(path.join(expectedDataDirectory, 'cache'));
    expect(config.CACHE_LIMIT_IN_BYTES).toBe(2_000_000_000);
  });

  it.each([
    {
      environment: {
        MUSE_BUNDLED_YT_DLP_PATH: '/bundled/yt-dlp',
        YT_DLP_PATH: '  /operator/yt-dlp  ',
      },
      expected: '/operator/yt-dlp',
      label: 'explicit path',
    },
    {
      environment: {MUSE_BUNDLED_YT_DLP_PATH: '  /bundled/yt-dlp  '},
      expected: '/bundled/yt-dlp',
      label: 'bundled path',
    },
    {
      environment: {},
      expected: 'yt-dlp',
      label: 'PATH lookup',
    },
  ])('selects the $label yt-dlp executable', async ({environment, expected}) => {
    const {default: Config} = await loadConfig({
      DISCORD_TOKEN: 'discord-secret',
      YOUTUBE_API_KEY: 'youtube-secret',
      ...environment,
    });
    const {getExecutable} = await import('../src/utils/yt-dlp.js');

    expect(new Config().YT_DLP_PATH).toBe(expected);
    expect(getExecutable()).toBe(expected);
  });
});

interface StartHarnessOptions {
  failAt?: string;
}

const loadStartHarness = async ({failAt}: StartHarnessOptions = {}) => {
  vi.resetModules();
  const events: string[] = [];
  const dataDirectory = path.join(temporaryRoot, 'runtime-data');
  const cacheDirectory = path.join(dataDirectory, 'cache');
  const tmpDirectory = path.join(cacheDirectory, 'tmp');
  const fail = (stage: string) => {
    if (failAt === stage) {
      throw new Error(`${stage} failed`);
    }
  };
  const makeDirectory = vi.fn(async (directory: string) => {
    const stage = directory === dataDirectory
      ? 'mkdir:data'
      : directory === cacheDirectory
        ? 'mkdir:cache'
        : 'mkdir:tmp';
    events.push(stage);
    fail(stage);
    await fs.mkdir(directory, {recursive: true});
    return directory;
  });
  const cleanup = vi.fn(async () => {
    events.push('cleanup');
    fail('cleanup');
    await Promise.all([
      fs.access(dataDirectory),
      fs.access(cacheDirectory),
      fs.access(tmpDirectory),
    ]);
  });
  const prepareYtDlp = vi.fn(async () => {
    events.push('prepare');
    fail('prepare');
  });
  const register = vi.fn(async () => {
    events.push('register');
    fail('register');
  });
  const config = {
    CACHE_DIR: cacheDirectory,
    DATA_DIR: dataDirectory,
  };
  const containerGet = vi.fn((type: symbol) => {
    switch (type.description) {
      case 'Bot':
        return {register};
      case 'Config':
        return config;
      case 'FileCache':
        return {cleanup};
      default:
        throw new Error(`Unexpected container lookup: ${String(type)}`);
    }
  });

  vi.doMock('make-dir', () => ({default: makeDirectory}));
  vi.doMock('../src/inversify.config.js', () => ({
    default: {get: containerGet},
  }));
  vi.doMock('../src/utils/prepare-yt-dlp.js', () => ({default: prepareYtDlp}));

  const {startBot} = await import('../src/index.js');

  return {
    cleanup,
    dataDirectory,
    events,
    makeDirectory,
    prepareYtDlp,
    register,
    startBot,
  };
};

describe('OPS-02 startup ordering and short-circuiting', () => {
  it('creates every runtime directory before cleanup, yt-dlp preparation, and registration', async () => {
    const harness = await loadStartHarness();

    await harness.startBot();

    expect(harness.events).toEqual([
      'mkdir:data',
      'mkdir:cache',
      'mkdir:tmp',
      'cleanup',
      'prepare',
      'register',
    ]);
    await expect(fs.stat(harness.dataDirectory)).resolves.toMatchObject({});
    expect(harness.makeDirectory).toHaveBeenCalledTimes(3);
    expect(harness.cleanup).toHaveBeenCalledOnce();
    expect(harness.prepareYtDlp).toHaveBeenCalledOnce();
    expect(harness.register).toHaveBeenCalledOnce();
  });

  it.each([
    {failAt: 'mkdir:data', expected: ['mkdir:data']},
    {failAt: 'mkdir:cache', expected: ['mkdir:data', 'mkdir:cache']},
    {failAt: 'mkdir:tmp', expected: ['mkdir:data', 'mkdir:cache', 'mkdir:tmp']},
    {failAt: 'cleanup', expected: ['mkdir:data', 'mkdir:cache', 'mkdir:tmp', 'cleanup']},
    {failAt: 'prepare', expected: ['mkdir:data', 'mkdir:cache', 'mkdir:tmp', 'cleanup', 'prepare']},
    {failAt: 'register', expected: ['mkdir:data', 'mkdir:cache', 'mkdir:tmp', 'cleanup', 'prepare', 'register']},
  ])('stops after a rejected $failAt stage', async ({failAt, expected}) => {
    const harness = await loadStartHarness({failAt});

    await expect(harness.startBot()).rejects.toThrow(`${failAt} failed`);
    expect(harness.events).toEqual(expected);
  });
});

describe('OPS-04 package start routing', () => {
  it('routes development and production starts through the database URL wrapper', async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(originalCwd, 'package.json'), 'utf8'),
    ) as {scripts: Record<string, string>};

    expect(packageJson.scripts['env:set-database-url']).toBe('tsx src/scripts/run-with-database-url.ts');
    expect(packageJson.scripts.dev).toBe('npm run env:set-database-url -- tsx watch src/scripts/start.ts');
    expect(packageJson.scripts.start).toBe('npm run env:set-database-url -- tsx src/scripts/migrate-and-start.ts');
  });
});
