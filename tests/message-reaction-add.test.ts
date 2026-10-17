import 'reflect-metadata';
import {Collection} from 'discord.js';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  containerGet: vi.fn(),
  canUsePlaybackCommand: vi.fn(),
}));

vi.mock('../src/inversify.config.js', () => ({
  default: {get: mocks.containerGet},
}));

vi.mock('../src/utils/can-use-playback-command.js', () => ({
  default: mocks.canUsePlaybackCommand,
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
  mocks.canUsePlaybackCommand.mockReset().mockResolvedValue(true);
});

describe('playback-message reaction controls', () => {
  it.each([
    ['⏮️', 'unskip', STATUS.PLAYING],
    ['⏭️', 'next', STATUS.PLAYING],
    ['⏪', 'seek', STATUS.PLAYING],
    ['⏩', 'fseek', STATUS.PLAYING],
    ['⏹️', 'stop', STATUS.PLAYING],
    ['🔀', 'shuffle', STATUS.PLAYING],
    ['⏯️', 'pause', STATUS.PLAYING],
    ['⏯️', 'resume', STATUS.PAUSED],
  ] as const)('checks /%s permissions before %s in state %s', async (emoji, command, status) => {
    const player = makePlayer({status});
    const {reaction, remove} = makeReaction(emoji, player);
    mocks.canUsePlaybackCommand.mockResolvedValue(false);

    await handleMessageReactionAdd(reaction as never, user as never);

    expect(mocks.canUsePlaybackCommand).toHaveBeenCalledExactlyOnceWith(reaction.message, user.id, command);
    expect(remove).toHaveBeenCalledWith(user.id);
    for (const action of [player.back, player.forward, player.seek, player.stop, player.shuffle, player.pause, player.play]) {
      expect(action).not.toHaveBeenCalled();
    }
  });

  it.each(['message replaced', 'listener left', 'pause became resume'])(
    'rechecks the action after permission lookup when %s', async change => {
      const player = makePlayer();
      const {reaction} = makeReaction('⏯️', player);
      mocks.canUsePlaybackCommand.mockImplementation(async () => {
        if (change === 'message replaced') {
          player.isPlayingMessage.mockReturnValue(false);
        } else if (change === 'listener left') {
          reaction.message.guild.members.cache.get(user.id)!.voice.channelId = 'other-voice-id';
        } else {
          player.status = STATUS.PAUSED;
        }
        return true;
      });

      await handleMessageReactionAdd(reaction as never, user as never);

      expect(player.pause).not.toHaveBeenCalled();
      expect(player.play).not.toHaveBeenCalled();
    },
  );

  it('checks permissions again for a queued reaction after access is revoked', async () => {
    const player = makePlayer();
    const first = makeReaction('⏹️', player);
    const second = makeReaction('⏹️', player);
    mocks.canUsePlaybackCommand.mockResolvedValueOnce(true).mockResolvedValue(false);

    await Promise.all([
      handleMessageReactionAdd(first.reaction as never, user as never),
      handleMessageReactionAdd(second.reaction as never, user as never),
    ]);

    expect(mocks.canUsePlaybackCommand).toHaveBeenCalledTimes(2);
    expect(player.stop).toHaveBeenCalledOnce();
  });

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
    expect(player.seek.mock.calls).toEqual([[40, {preservePausedState: true}], [20, {preservePausedState: true}]]);
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
    expect(player.seek).toHaveBeenLastCalledWith(40, {preservePausedState: true});

    await handleMessageReactionAdd(makeReaction('⏪', player).reaction as never, user as never);
    expect(player.seek).toHaveBeenLastCalledWith(20, {preservePausedState: true});
  });

  it('clamps seeks and lets the player preserve pause within the seek attempt', async () => {
    const player = makePlayer({
      getPosition: vi.fn(() => 5),
      pause: vi.fn(),
      status: STATUS.PAUSED,
    });
    await handleMessageReactionAdd(makeReaction('⏪', player).reaction as never, user as never);

    expect(player.seek).toHaveBeenCalledWith(0, {preservePausedState: true});
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('does not pause newer playback after a paused seek finishes', async () => {
    const player = makePlayer({status: STATUS.PAUSED});
    player.seek.mockImplementation(async () => {
      // Another command can replace this attempt while it waits for voice readiness.
      player.status = STATUS.PLAYING;
    });

    await handleMessageReactionAdd(makeReaction('⏩', player).reaction as never, user as never);

    expect(player.pause).not.toHaveBeenCalled();
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
