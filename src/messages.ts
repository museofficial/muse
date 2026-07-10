// Central catalog of every string the bot sends to Discord (replies, DMs, and
// thrown-error text that bot.ts renders as an error embed). Edit here to
// customize the bot's wording without touching command logic.
const messages = {
  common: {
    errorPrefix: '🚫 ope:',
    unknownError: 'unknown error',
    yes: 'yes',
    no: 'no',
  },
  errors: {
    dmNotSupported: 'you can\'t use this bot in a DM',
    notInVoiceChannel: 'gotta be in a voice channel',
    notConnected: 'not connected',
    notCurrentlyPlaying: 'not currently playing',
    nothingIsPlaying: 'nothing is playing',
    cantSeekLive: 'can\'t seek in a livestream',
    seekPastEnd: 'can\'t seek past the end of the song',
    invalidPosition: 'position must be at least 1',
    unknownSubcommand: 'unknown subcommand',
    noSongToSkip: 'no song to skip to',
  },
  shared: {
    seekedTo: (time: string) => `👍 seeked to ${time}`,
  },
  clear: {
    success: 'clearer than a field after a fresh harvest',
  },
  pause: {
    success: 'the stop-and-go light is now red',
  },
  stop: {
    success: 'u betcha, stopped',
  },
  disconnect: {
    success: 'u betcha, disconnected',
  },
  shuffle: {
    notEnoughSongs: 'not enough songs to shuffle',
    success: 'shuffled',
  },
  loop: {
    noSongToLoop: 'no song to loop!',
    enabled: 'looped :)',
    disabled: 'stopped looping :(',
  },
  loopQueue: {
    noSongsToLoop: 'no songs to loop!',
    notEnoughSongs: 'not enough songs to loop a queue!',
    enabled: 'looped queue :)',
    disabled: 'stopped looping queue :(',
  },
  volume: {
    success: (level: number) => `Set volume to ${level}%`,
  },
  move: {
    success: (title: string, to: number) => `moved **${title}** to position **${String(to)}**`,
  },
  remove: {
    invalidRange: 'range must be at least 1',
    success: ':wastebasket: removed',
  },
  replay: {
    cantReplayLive: 'can\'t replay a livestream',
    success: '👍 replayed the current song',
  },
  fseek: {
    missingSeekValue: 'missing seek value',
  },
  resume: {
    alreadyPlaying: 'already playing, give me a song name',
    nothingToPlay: 'nothing to play',
    success: 'the stop-and-go light is now green',
  },
  skip: {
    invalidNumber: 'invalid number of songs to skip',
    success: 'keep \'er movin\'',
  },
  unskip: {
    noSongToGoBack: 'no song to go back to',
    success: 'back \'er up\'',
  },
  nowPlaying: {
    nothingPlaying: 'nothing is currently playing',
  },
  queue: {
    noPlayingSong: 'No playing song found',
    empty: 'queue is empty',
    tooBig: 'the queue isn\'t that big',
  },
  config: {
    invalidLimit: 'invalid limit',
    limitUpdated: '👍 limit updated',
    waitDelayUpdated: '👍 wait delay updated',
    leaveSettingUpdated: '👍 leave setting updated',
    queueAddNotificationUpdated: '👍 queue add notification setting updated',
    autoAnnounceUpdated: '👍 auto announce setting updated',
    persistentNowPlayingMessageUpdated: '👍 persistent now playing message setting updated',
    volumeSettingUpdated: '👍 volume setting updated',
    defaultQueuePageSizeUpdated: '👍 default queue page size updated',
    turnDownVolumeUpdated: '👍 turn down volume setting updated',
    turnDownVolumeTargetUpdated: '👍 turn down volume target setting updated',
    title: 'Config',
    labels: {
      playlistLimit: 'Playlist Limit',
      waitBeforeLeave: 'Wait before leaving after queue empty',
      leaveIfNoListeners: 'Leave if there are no listeners',
      autoAnnounceNextSong: 'Auto announce next song in queue',
      persistentNowPlayingMessage: 'Persistent now playing message',
      queueAddResponseEphemeral: 'Add to queue reponses show for requester only',
      defaultVolume: 'Default Volume',
      defaultQueuePageSize: 'Default queue page size',
      turnDownVolumeWhenPeopleSpeak: 'Reduce volume when people speak',
    },
  },
  favorites: {
    noFavoriteWithName: 'no favorite with that name exists',
    noneYet: 'there aren\'t any favorites yet',
    alreadyExists: 'a favorite with that name already exists',
    created: '👍 favorite created',
    onlyOwnFavorites: 'you can only remove your own favorites',
    removed: '👍 favorite removed',
  },
  queueAdd: {
    noSongsFound: 'no songs found',
    resumingPlayback: 'resuming playback',
    single: (title: string, opts: {front: boolean; skipped: boolean; extra: string}) =>
      `u betcha, **${title}** added to the${opts.front ? ' front of the' : ''} queue${opts.skipped ? 'and current track skipped' : ''}${opts.extra}`,
    multiple: (title: string, count: number, opts: {skipped: boolean; extra: string}) =>
      `u betcha, **${title}** and ${count} other songs were added to the queue${opts.skipped ? 'and current track skipped' : ''}${opts.extra}`,
  },
  guildCreate: {
    welcomeDm: '👋 Hi! Someone (probably you) just invited me to a server you own. By default, I\'m usable by all guild member in all guild channels. To change this, check out the wiki page on permissions: https://github.com/museofficial/muse/wiki/Configuring-Bot-Permissions.',
  },
};

export default messages;
