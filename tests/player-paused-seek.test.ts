import 'reflect-metadata';
import {once} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

vi.mock('../src/inversify.config.js', () => ({default: {get: vi.fn()}}));

vi.mock('@discordjs/voice', async importOriginal => ({
  ...await importOriginal<typeof import('@discordjs/voice')>(),
  entersState: vi.fn().mockResolvedValue(undefined),
}));

import {AudioPlayer, AudioPlayerStatus, createAudioPlayer, createAudioResource, StreamType} from '@discordjs/voice';
import Player, {MediaSource, STATUS} from '../src/services/player.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('does not start buffering replacement audio for a paused seek', async () => {
  const oldStream = new PassThrough({objectMode: true});
  const oldAudioPlayer = createAudioPlayer();
  const oldResource = createAudioResource(oldStream, {inputType: StreamType.Opus});
  oldAudioPlayer.play(oldResource);
  const oldPlaying = once(oldAudioPlayer, AudioPlayerStatus.Playing);
  oldStream.write(Buffer.from([0xf8, 0xff, 0xfe]));
  await oldPlaying;
  expect(oldAudioPlayer.pause()).toBe(true);

  const stream = new PassThrough({objectMode: true});
  const getStream = vi.fn().mockResolvedValue(stream);
  const player = new Player({} as never, 'guild-id');
  player.add({
    title: 'Track', artist: 'Test', url: '12345678901', source: MediaSource.Youtube,
    length: 100, offset: 0, playlist: null, isLive: false, thumbnailUrl: null,
    addedInChannelId: 'text', requestedBy: 'user',
  });
  player.voiceConnection = {state: {status: 'ready'}, subscribe: vi.fn()} as never;
  Object.assign(player, {
    audioPlayer: oldAudioPlayer,
    audioResource: oldResource,
    positionInSeconds: 15,
    getStream,
    createAudioStream: (audio: PassThrough) => createAudioResource(audio, {inputType: StreamType.Opus}),
  });

  try {
    await player.seek(25, {preservePausedState: true});

    expect(oldAudioPlayer.state.status).toBe(AudioPlayerStatus.Idle);
    expect(getStream).not.toHaveBeenCalled();
    expect(player.status).toBe(STATUS.PAUSED);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(player.getPosition()).toBe(25);

    // Resource creation waits for an explicit resume. The real voice player
    // cannot pause Buffering, so starting it during the seek would leak audio.
    await player.play();
    const audioPlayer = (player as unknown as {audioPlayer: AudioPlayer}).audioPlayer;
    expect(audioPlayer.state.status).toBe(AudioPlayerStatus.Buffering);
    expect(audioPlayer.pause()).toBe(false);
    expect(getStream).toHaveBeenCalledWith(player.getCurrent(), {seek: 25, to: 100}, expect.objectContaining({song: player.getCurrent()}));
    const playing = once(audioPlayer, AudioPlayerStatus.Playing);
    stream.write(Buffer.from([0xf8, 0xff, 0xfe]));
    await playing;
    expect(player.status).toBe(STATUS.PLAYING);
    expect(audioPlayer.state.status).toBe(AudioPlayerStatus.Playing);
    player.pause();
    audioPlayer.stop(true);
  } finally {
    oldAudioPlayer.stop(true);
    oldStream.destroy();
    stream.destroy();
  }
});
