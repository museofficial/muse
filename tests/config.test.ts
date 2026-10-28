import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const loadConfig = async (cacheLimit: string) => {
  vi.stubEnv('DISCORD_TOKEN', 'test-discord-token');
  vi.stubEnv('YOUTUBE_API_KEY', 'test-youtube-key');
  vi.stubEnv('DATA_DIR', '/tmp/muse-config-test');
  vi.stubEnv('CACHE_LIMIT', cacheLimit);
  const {default: Config} = await import('../src/services/config.js');
  return Config;
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Config intro and outro sounds', () => {
  const loadWithSounds = async (intro?: string, outro?: string) => {
    if (intro !== undefined) {
      vi.stubEnv('INTRO_SOUND', intro);
    }

    if (outro !== undefined) {
      vi.stubEnv('OUTRO_SOUND', outro);
    }

    return loadConfig('2GB');
  };

  it('leaves both jingles off by default', async () => {
    vi.stubEnv('INTRO_SOUND', '');
    vi.stubEnv('OUTRO_SOUND', '');
    const Config = await loadConfig('2GB');
    const config = new Config();

    expect(config.INTRO_SOUND).toBe('');
    expect(config.OUTRO_SOUND).toBe('');
  });

  it('resolves bundled names case-insensitively to shipped files', async () => {
    const Config = await loadWithSounds('Dark', 'dark-tapestop');
    const config = new Config();

    // path.relative tolerates drive-letter case differences on Windows.
    expect(path.relative(path.resolve('src', 'sounds', 'intro', 'dark.ogg'), config.INTRO_SOUND)).toBe('');
    expect(path.relative(path.resolve('src', 'sounds', 'outro', 'dark-tapestop.ogg'), config.OUTRO_SOUND)).toBe('');
    expect(fs.existsSync(config.INTRO_SOUND)).toBe(true);
    expect(fs.existsSync(config.OUTRO_SOUND)).toBe(true);
  });

  it('only offers outro-only clips as outros', async () => {
    const {getBundledSoundNames} = await import('../src/services/config.js');

    expect(getBundledSoundNames('intro')).toEqual(['bright', 'chime', 'dark']);
    expect(getBundledSoundNames('outro')).toEqual(['bright', 'chime', 'dark', 'dark-tapestop']);
  });

  it('accepts a custom file path', async () => {
    const custom = path.resolve('src', 'sounds', 'intro', 'chime.ogg');
    const Config = await loadWithSounds(custom, 'none');
    const config = new Config();

    expect(config.INTRO_SOUND).toBe(custom);
    expect(config.OUTRO_SOUND).toBe('');
  });

  it('starts with the jingle disabled and logs an error for an unknown name or missing file', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Config = await loadWithSounds('spooky', 'dark');
    const config = new Config();

    expect(config.INTRO_SOUND).toBe('');
    expect(config.OUTRO_SOUND).not.toBe('');
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).toMatch(/INTRO_SOUND.*"spooky".*bright, chime, dark.*intro is disabled/);
    consoleError.mockRestore();
  });
});

describe('bundled sound build step', () => {
  it('copies every bundled clip into dist as part of the build', async () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {scripts: Record<string, string>};
    expect(packageJson.scripts.build).toContain('node dist/scripts/copy-sounds.js');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-sounds-'));
    fs.mkdirSync(path.join(directory, 'src', 'sounds', 'intro'), {recursive: true});
    fs.mkdirSync(path.join(directory, 'src', 'sounds', 'outro'), {recursive: true});
    fs.writeFileSync(path.join(directory, 'src', 'sounds', 'intro', 'dark.ogg'), 'intro');
    fs.writeFileSync(path.join(directory, 'src', 'sounds', 'outro', 'dark.ogg'), 'outro');
    const originalCwd = process.cwd();
    try {
      process.chdir(directory);
      await import('../src/scripts/copy-sounds.js');
    } finally {
      process.chdir(originalCwd);
    }

    expect(fs.readFileSync(path.join(directory, 'dist', 'sounds', 'intro', 'dark.ogg'), 'utf8')).toBe('intro');
    expect(fs.readFileSync(path.join(directory, 'dist', 'sounds', 'outro', 'dark.ogg'), 'utf8')).toBe('outro');
    fs.rmSync(directory, {recursive: true, force: true});
  });
});

describe('Config cache limit validation', () => {
  it('rejects a negative cache limit with a clear error', async () => {
    const Config = await loadConfig('-1B');

    expect(() => new Config()).toThrow(/CACHE_LIMIT_IN_BYTES.*non-negative/i);
  });

  it('accepts a zero-byte cache limit', async () => {
    const Config = await loadConfig('0B');

    expect(new Config().CACHE_LIMIT_IN_BYTES).toBe(0);
  });
});
