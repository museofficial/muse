import {PassThrough} from 'node:stream';
import {createAudioResource, StreamType, type AudioPlayer, type AudioResource} from '@discordjs/voice';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../src/services/file-cache.js', () => ({default: class {}}));
vi.mock('../src/utils/get-guild-settings.js', () => ({
  getGuildSettings: vi.fn(async () => ({secondsToWaitAfterQueueEmpties: 0, autoAnnounceNextSong: false})),
}));
vi.mock('../src/utils/build-embed.js', () => ({buildPlayingMessageEmbed: vi.fn()}));

import Player, {MediaSource, STATUS} from '../src/services/player.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const makePlayer = () => {
  const player = new Player({} as never, 'guild-id');
  player.voiceConnection = {state: {status: 'ready'}, subscribe: vi.fn(), destroy: vi.fn()} as never;
  player.add({title: 'Track', artist: 'Artist', url: 'abcdefghijk', length: 100, offset: 0,
    source: MediaSource.Youtube, isLive: false, playlist: null, thumbnailUrl: null,
    addedInChannelId: 'text-id', requestedBy: 'user-id'});
  const input = new PassThrough();
  Object.assign(player, {
    getStream: vi.fn(async () => input),
    createAudioStream: () => createAudioResource(input, {inputType: StreamType.Opus}),
  });
  return {input, player, state: player as unknown as {audioPlayer: AudioPlayer; audioResource: AudioResource}};
};

describe('real Discord audio resource errors', () => {
  it.each(['play', 'seek'] as const)('handles a resource failure during %s without throwing or losing idle advancement', async action => {
    const {player, state} = makePlayer();
    if (action === 'play') {
      await player.play();
    } else {
      await player.seek(10);
    }
    const resource = state.audioResource;
    expect(() => resource.playStream.emit('error', new Error('decoder failed at https://media.example/private'))).not.toThrow();
    await vi.waitFor(() => expect(player.status).toBe(STATUS.IDLE));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Audio player failed'));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('https://media.example');
    player.disconnect();
  });
});
