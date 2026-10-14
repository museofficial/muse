import 'reflect-metadata';
import {Collection} from 'discord.js';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  containerGet: vi.fn(),
}));

vi.mock('../src/inversify.config.js', () => ({
  default: {get: mocks.containerGet},
}));

import handleMessageReactionAdd from '../src/events/message-reaction-add.js';
import {STATUS} from '../src/services/player.js';

const makePlayer = (overrides: Record<string, unknown> = {}) => ({
  back: vi.fn().mockResolvedValue(undefined),
  canGoBack: vi.fn(() => true),
  canGoForward: vi.fn(() => true),
  forward: vi.fn().mockResolvedValue(undefined),
  getCurrent: vi.fn(() => ({isLive: false, length: 100})),
  getPosition: vi.fn(() => 30),
  isQueueEmpty: vi.fn(() => false),
  isPlayingMessage: vi.fn(() => true),
  pause: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  refreshPlayingMessage: vi.fn(),
  seek: vi.fn().mockResolvedValue(undefined),
  shuffle: vi.fn(),
  status: STATUS.PLAYING,
  stop: vi.fn(),
  voiceConnection: {joinConfig: {channelId: 'voice-id'}},
  ...overrides,
});

const makeReaction = (emoji: string, player: ReturnType<typeof makePlayer>, memberVoiceId = 'voice-id') => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const guild = {
    id: 'guild-id',
    members: {
      cache: new Collection([
        ['user-id', {voice: {channelId: memberVoiceId}}],
      ]),
    },
  };
  const reaction = {
    emoji: {name: emoji},
    message: {guild, id: 'playing-message-id', partial: false},
    partial: false,
    users: {remove},
  };
  mocks.containerGet.mockReturnValue({getExisting: vi.fn(() => player)});

  return {reaction, remove};
};

const user = {bot: false, id: 'user-id'};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('playback-message reaction controls', () => {
  it.each(['message replaced', 'listener left'])('rechecks access after reaction removal when %s', async change => {
    const player = makePlayer();
    const {reaction, remove} = makeReaction('⏩', player);
    remove.mockImplementation(async () => {
      if (change === 'message replaced') {
        player.isPlayingMessage.mockReturnValue(false);
      } else {
        reaction.message.guild.members.cache.get(user.id)!.voice.channelId = 'other-voice-id';
      }
    });

    await handleMessageReactionAdd(reaction as never, user as never);

    expect(player.seek).not.toHaveBeenCalled();
  });

  it('keeps controls in arrival order while reaction removal is pending', async () => {
    const player = makePlayer();
    const first = makeReaction('⏩', player);
    const second = makeReaction('⏪', player);
    let release!: () => void;
    const pendingRemoval = new Promise<void>(resolve => { release = resolve; });
    first.remove.mockReturnValue(pendingRemoval);

    const firstAction = handleMessageReactionAdd(first.reaction as never, user as never);
    const secondAction = handleMessageReactionAdd(second.reaction as never, user as never);
    // Flush removal continuations while leaving the first removal unresolved.
    await new Promise(resolve => setTimeout(resolve, 0));
    const callsWhileBlocked = player.seek.mock.calls.length;
    release();
    await Promise.all([firstAction, secondAction]);

    expect(callsWhileBlocked).toBe(0);
    expect(player.seek.mock.calls).toEqual([[40], [20]]);
  });

  it.each(['⏭️', '⏭'])('skips to the next track with %s, including livestreams', async emoji => {
    const player = makePlayer({getCurrent: vi.fn(() => ({isLive: true, length: 0}))});

    await handleMessageReactionAdd(makeReaction(emoji, player).reaction as never, user as never);

    expect(player.forward).toHaveBeenCalledExactlyOnceWith(1);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it.each(['⏮️', '⏮'])('returns to the previous track with %s', async emoji => {
    const player = makePlayer();

    await handleMessageReactionAdd(makeReaction(emoji, player).reaction as never, user as never);

    expect(player.back).toHaveBeenCalledOnce();
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('ignores unavailable track transitions', async () => {
    const player = makePlayer({canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false)});

    await handleMessageReactionAdd(makeReaction('⏮️', player).reaction as never, user as never);
    await handleMessageReactionAdd(makeReaction('⏭️', player).reaction as never, user as never);

    expect(player.back).not.toHaveBeenCalled();
    expect(player.forward).not.toHaveBeenCalled();
    expect(player.seek).not.toHaveBeenCalled();
  });

  it.each(['⏮️', '⏭️'])('rejects %s outside the voice channel or on stale messages', async emoji => {
    const player = makePlayer();
    await handleMessageReactionAdd(makeReaction(emoji, player, 'other-voice-id').reaction as never, user as never);
    player.isPlayingMessage.mockReturnValue(false);
    await handleMessageReactionAdd(makeReaction(emoji, player).reaction as never, user as never);

    expect(player.back).not.toHaveBeenCalled();
    expect(player.forward).not.toHaveBeenCalled();
  });

  it('fast-forwards and rewinds by ten seconds', async () => {
    const player = makePlayer();

    await handleMessageReactionAdd(makeReaction('⏩', player).reaction as never, user as never);
    expect(player.seek).toHaveBeenLastCalledWith(40);

    await handleMessageReactionAdd(makeReaction('⏪', player).reaction as never, user as never);
    expect(player.seek).toHaveBeenLastCalledWith(20);
  });

  it('clamps seeks at track boundaries and preserves a paused state', async () => {
    const player = makePlayer({
      getPosition: vi.fn(() => 5),
      pause: vi.fn(),
      status: STATUS.PAUSED,
    });
    player.seek.mockImplementation(async () => {
      player.status = STATUS.PLAYING;
    });

    await handleMessageReactionAdd(makeReaction('⏪', player).reaction as never, user as never);

    expect(player.seek).toHaveBeenCalledWith(0);
    expect(player.pause).toHaveBeenCalledOnce();
  });

  it('toggles pause/resume and stops playback', async () => {
    const player = makePlayer();

    await handleMessageReactionAdd(makeReaction('⏯️', player).reaction as never, user as never);
    expect(player.pause).toHaveBeenCalledOnce();

    player.status = STATUS.PAUSED;
    await handleMessageReactionAdd(makeReaction('⏯', player).reaction as never, user as never);
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.refreshPlayingMessage).toHaveBeenCalledOnce();

    await handleMessageReactionAdd(makeReaction('⏹️', player).reaction as never, user as never);
    expect(player.stop).toHaveBeenCalledOnce();
  });

  it('shuffles the upcoming queue and ignores an empty queue', async () => {
    const player = makePlayer();

    await handleMessageReactionAdd(makeReaction('🔀', player).reaction as never, user as never);
    expect(player.shuffle).toHaveBeenCalledOnce();

    player.isQueueEmpty.mockReturnValue(true);
    await handleMessageReactionAdd(makeReaction('🔀', player).reaction as never, user as never);
    expect(player.shuffle).toHaveBeenCalledOnce();
  });

  it('rejects reactions from outside the bot voice channel', async () => {
    const player = makePlayer();
    const {reaction, remove} = makeReaction('⏩', player, 'other-voice-id');

    await handleMessageReactionAdd(reaction as never, user as never);

    expect(remove).toHaveBeenCalledWith('user-id');
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('ignores controls on stale messages and livestream seeks', async () => {
    const stalePlayer = makePlayer({isPlayingMessage: vi.fn(() => false)});
    await handleMessageReactionAdd(makeReaction('⏩', stalePlayer).reaction as never, user as never);
    expect(stalePlayer.seek).not.toHaveBeenCalled();

    const livePlayer = makePlayer({getCurrent: vi.fn(() => ({isLive: true, length: 0}))});
    await handleMessageReactionAdd(makeReaction('⏩', livePlayer).reaction as never, user as never);
    expect(livePlayer.seek).not.toHaveBeenCalled();
  });
});
