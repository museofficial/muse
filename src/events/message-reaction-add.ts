import {
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from 'discord.js';
import container from '../inversify.config.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import {TYPES} from '../types.js';
import canUsePlaybackCommand from '../utils/can-use-playback-command.js';
import {MUSIC_CONTROLS, MUSIC_CONTROL_SEEK_SECONDS} from '../utils/constants.js';

type MusicControl = keyof typeof MUSIC_CONTROLS;

const commandForControl = (control: MusicControl, status: STATUS): string => {
  const commands = {
    'previous-track': 'unskip',
    'next-track': 'next',
    rewind: 'seek',
    'fast-forward': 'fseek',
    stop: 'stop',
    shuffle: 'shuffle',
    'pause-resume': status === STATUS.PAUSED ? 'resume' : 'pause',
  };
  return commands[control];
};

const normalizeEmoji = (emoji: string) => emoji.replace(/\uFE0F/g, '');
const controls = new Map<string, MusicControl>(
  Object.entries(MUSIC_CONTROLS).map(([control, emoji]) => [normalizeEmoji(emoji), control as MusicControl]),
);

// Discord does not await event listeners. Keep transport actions ordered per
// guild so rapid reactions cannot race two FFmpeg seek/restart operations.
const pendingGuildActions = new Map<string, Promise<void>>();
const enqueueGuildAction = async (guildId: string, action: () => Promise<void>): Promise<void> => {
  const previous = pendingGuildActions.get(guildId) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(action);
  pendingGuildActions.set(guildId, pending);

  try {
    await pending;
  } finally {
    if (pendingGuildActions.get(guildId) === pending) {
      pendingGuildActions.delete(guildId);
    }
  }
};

export default async (
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> => {
  if (user.bot) {
    return;
  }

  const control = controls.get(normalizeEmoji(reaction.emoji.name ?? ''));
  if (!control) {
    return;
  }

  const completeReaction = reaction.partial ? await reaction.fetch() : reaction;
  const message = completeReaction.message.partial
    ? await completeReaction.message.fetch()
    : completeReaction.message;
  const {guild} = message;
  if (!guild) {
    return;
  }

  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);
  const player = playerManager.getExisting(guild.id);
  if (!player || !player.isPlayingMessage(message.id)) {
    return;
  }

  // Only listeners in the bot's current voice channel can control playback.
  // This prevents an unrelated text-channel reader from taking over a session.
  const canControlPlayback = () => {
    const botVoiceChannelId = player.voiceConnection?.joinConfig.channelId;
    return Boolean(botVoiceChannelId)
      && guild.members.cache.get(user.id)?.voice.channelId === botVoiceChannelId
      && player.isPlayingMessage(message.id);
  };

  if (!canControlPlayback()) {
    await completeReaction.users.remove(user.id).catch(() => undefined);
    return;
  }

  const isAuthorized = async (): Promise<boolean> => {
    // A previous action or a channel change can invalidate a waiting control.
    if (!canControlPlayback()) {
      return false;
    }

    const command = commandForControl(control, player.status);
    if (!await canUsePlaybackCommand(message, user.id, command)) {
      return false;
    }

    // Permission requests yield to other events and slash commands. Do not
    // apply a stale action or turn an authorized pause into an unchecked resume.
    return canControlPlayback() && command === commandForControl(control, player.status);
  };

  await enqueueGuildAction(guild.id, async () => {
    // Queue before removing the reaction so REST latency cannot reorder controls.
    // Without Manage Messages, the listener must untick the reaction manually.
    await completeReaction.users.remove(user.id).catch(() => undefined);

    if (!await isAuthorized()) {
      return;
    }

    if (control === 'previous-track') {
      if (player.canGoBack()) {
        await player.back();
      }

      return;
    }

    if (control === 'next-track') {
      if (player.canGoForward(1)) {
        await player.forward(1);
      }

      return;
    }

    if (control === 'stop') {
      await player.stop();
      return;
    }

    if (control === 'shuffle') {
      // Match /shuffle: only reorder songs that are still upcoming. Player
      // requests a playing-message refresh after changing the queue.
      if (!player.isQueueEmpty()) {
        player.shuffle();
      }

      return;
    }

    if (control === 'pause-resume') {
      if (player.status === STATUS.PLAYING) {
        player.pause();
      } else if (player.status === STATUS.PAUSED && player.getCurrent()) {
        await player.play();
        player.refreshPlayingMessage();
      }

      return;
    }

    const song = player.getCurrent();
    if (!song || song.isLive) {
      return;
    }

    const direction = control === 'fast-forward' ? 1 : -1;
    const position = player.getPosition();
    const target = Math.max(0, Math.min(song.length, position + (direction * MUSIC_CONTROL_SEEK_SECONDS)));
    if (target === position) {
      return;
    }

    await player.seek(target, {preservePausedState: true});
  });
};
