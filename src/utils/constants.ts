export const ONE_HOUR_IN_SECONDS = 60 * 60;
export const ONE_MINUTE_IN_SECONDS = 1 * 60;
export const DEFAULT_PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS = 5;

// These controls are added in playback order and intentionally use standard
// Unicode emoji so they work without guild-specific emoji configuration.
export const MUSIC_CONTROLS = {
  'previous-track': '⏮️',
  rewind: '⏪',
  'pause-resume': '⏯️',
  'fast-forward': '⏩',
  'next-track': '⏭️',
  stop: '⏹️',
  shuffle: '🔀',
} as const;
export const MUSIC_CONTROL_EMOJIS = Object.values(MUSIC_CONTROLS);
export const MUSIC_CONTROL_SEEK_SECONDS = 10;

// In addition to voice access, reaction controls need Add Reactions, View
// Channel, Send Messages, Manage Messages, Embed Links, and Message History.
export const BOT_INVITE_PERMISSIONS = '36793408';
