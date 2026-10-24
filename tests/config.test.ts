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
