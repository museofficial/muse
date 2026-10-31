import {ChatInputCommandInteraction, GuildMember, GuildTextBasedChannel, escapeMarkdown} from 'discord.js';
import {inject, injectable} from 'inversify';
import shuffle from 'array-shuffle';
import uniqueSongs from '../utils/unique-songs.js';
import {TYPES} from '../types.js';
import GetSongs from '../services/get-songs.js';
import {MediaSource, SongMetadata, STATUS} from './player.js';
import SessionPlayer from './session-player.js';
import PlayerManager from '../managers/player.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {SponsorBlock} from 'sponsorblock-api';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import formatSongReply from '../utils/format-song-reply.js';
import {LocalizedError, t} from '../i18n/index.js';

const isSameQueueEntry = (capturedId: number | null, currentId: number | null) => (
  capturedId !== null && capturedId === currentId
);

const normalizeSkipError = (error: unknown) => (
  error instanceof Error && error.message === 'No songs in queue to forward to.'
    ? new LocalizedError('error.noSongToSkipTo')
    : error
);

@injectable()
export default class AddQueryToQueue {
  private readonly sponsorBlock?: SponsorBlock;
  private sponsorBlockDisabledUntil?: Date;
  private readonly sponsorBlockTimeoutDelay;
  private readonly cache: KeyValueCacheProvider;

  constructor(@inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs,
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
    @inject(TYPES.Config) private readonly config: Config,
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider,
    @inject(TYPES.Services.SessionPlayer) private readonly sessionPlayer: SessionPlayer) {
    this.sponsorBlockTimeoutDelay = config.SPONSORBLOCK_TIMEOUT;
    this.sponsorBlock = config.ENABLE_SPONSORBLOCK
      ? new SponsorBlock('muse-sb-integration') // UserID matters only for submissions
      : undefined;
    this.cache = cache;
  }

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    skipCurrentTrack,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    skipCurrentTrack: boolean;
    interaction: ChatInputCommandInteraction;
  }): Promise<void> {
    const guildId = interaction.guild!.id;
    const {locale} = interaction;
    const player = this.playerManager.get(guildId);
    const currentQueueEntryId = player.getCurrentQueueEntryId();
    const wasPlayingSong = currentQueueEntryId !== null;

    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await getGuildSettings(guildId);

    const {playlistLimit} = settings;

    await interaction.deferReply({ephemeral: false});

    let [newSongs, extraMsg] = await this.getSongs.getSongs(query, playlistLimit, shouldSplitChapters, locale);

    if (newSongs.length === 0) {
      throw new LocalizedError('error.noSongsFound');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(uniqueSongs(newSongs));
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(newSongs.map(this.skipNonMusicSegments.bind(this)));
    }

    // A request during the outro rejoins once the bot has left.
    await player.waitForPendingLeave();
    const queuedSongs = newSongs.map(song => ({
      ...song,
      addedInChannelId: interaction.channel!.id,
      requestedBy: interaction.member!.user.id,
    }));
    const needsConnection = player.voiceConnection === null;
    if (needsConnection) {
      // A failed join must not leave an unacknowledged request in the queue.
      // Resolve audio during the handshake without changing the saved queue.
      const connection = player.connect(targetVoiceChannel);
      player.prepareAudio(player.getCurrent() ?? queuedSongs[0]);
      await connection;
    } else {
      // Let an existing session recover without changing its channel or paused state.
      await player.ensureVoiceConnectionReady();
    }

    queuedSongs.forEach((song, index) => {
      player.add(song, {immediate: addToFrontOfQueue, immediateOffset: index});
    });

    const firstSong = newSongs[0];

    let statusMsg = '';

    if (needsConnection) {
      // Resume / start playback
      await player.playIntro();
      await player.play();

      if (wasPlayingSong) {
        statusMsg = t(locale, 'queueAdd.resuming');
      }
    } else if (player.status === STATUS.IDLE) {
      // Player is idle, start playback instead
      if (this.config.INTRO_SOUND_TRIGGER === 'queue-start') {
        await player.playIntro();
      }

      await player.play();
    }

    if (!player.getCurrent()) {
      throw new LocalizedError('error.noPlayableSongs');
    }

    let didSkipCurrentTrack = false;
    if (skipCurrentTrack && isSameQueueEntry(currentQueueEntryId, player.getCurrentQueueEntryId())) {
      try {
        await player.forward(1);
        didSkipCurrentTrack = true;
      } catch (error: unknown) {
        throw normalizeSkipError(error);
      }
    }

    extraMsg = [statusMsg, extraMsg].filter(Boolean).join(', ');
    if (extraMsg !== '') {
      extraMsg = t(locale, 'queueAdd.notes', {notes: extraMsg});
    }

    const songTitle = escapeMarkdown(firstSong.title);
    const responseContent = (publicationWarning = '') => {
      const notes = `${extraMsg}${publicationWarning}`;
      return formatSongReply(songTitle, title => {
        if (newSongs.length > 1) {
          return t(locale, didSkipCurrentTrack ? 'queueAdd.addedManySkipped' : 'queueAdd.addedMany', {title, count: newSongs.length - 1, notes});
        }

        const key = addToFrontOfQueue
          ? (didSkipCurrentTrack ? 'queueAdd.addedFrontSkipped' : 'queueAdd.addedFront')
          : (didSkipCurrentTrack ? 'queueAdd.addedSkipped' : 'queueAdd.added');
        return t(locale, key, {title, notes});
      });
    };

    const receipt = interaction.editReply({content: responseContent(), allowedMentions: {parse: []}});
    // Capture this session before the reply resolves, so a delayed Discord
    // response cannot move a later session's player onto an older request.
    const publication = this.sessionPlayer.attachToReply(player, interaction.channel as GuildTextBasedChannel, receipt).then(() => '', () => {
      // The tracks have already been added. A Discord/persistence failure must
      // not make the requester retry and accidentally enqueue them twice.
      console.warn(`Could not publish the session player for guild ${guildId}.`);
      return t(locale, 'queueAdd.playerCardFailed');
    });

    await receipt;
    const publicationWarning = await publication;
    if (publicationWarning) {
      await interaction.editReply({content: responseContent(publicationWarning), allowedMentions: {parse: []}});
    }
  }

  private async skipNonMusicSegments(song: SongMetadata) {
    if (!this.sponsorBlock
          || (this.sponsorBlockDisabledUntil && new Date() < this.sponsorBlockDisabledUntil)
          || song.source !== MediaSource.Youtube
          || !song.url) {
      return song;
    }

    try {
      const segments = await this.cache.wrap(
        async () => this.sponsorBlock?.getSegments(song.url, ['music_offtopic']),
        {
          key: song.url, // Value is too short for hashing
          expiresIn: ONE_HOUR_IN_SECONDS,
        },
      ) ?? [];
      const originalStart = song.offset;
      const originalEnd = song.offset + song.length;
      const skipSegments = segments
        .filter(({startTime, endTime}) => endTime > originalStart && startTime < originalEnd)
        .sort((a, b) => a.startTime - b.startTime)
        .reduce((acc: Array<{startTime: number; endTime: number}>, {startTime, endTime}) => {
          const previousSegment = acc[acc.length - 1];
          // If segments overlap merge
          if (previousSegment && previousSegment.endTime > startTime) {
            acc[acc.length - 1].endTime = Math.max(previousSegment.endTime, endTime);
          } else {
            acc.push({startTime, endTime});
          }

          return acc;
        }, []);

      const intro = skipSegments[0];
      const outro = skipSegments.at(-1);
      // SponsorBlock timestamps refer to the full source, including when this
      // queue entry is only a chapter. Clamp both trims to that entry's interval.
      const start = intro && intro.startTime <= originalStart + 2
        ? Math.min(originalEnd, Math.max(originalStart, Math.floor(intro.endTime)))
        : originalStart;
      const end = outro && outro.endTime >= originalEnd - 2
        ? Math.max(start, Math.min(originalEnd, outro.startTime))
        : originalEnd;
      song.offset = start;
      song.length = Math.max(0, end - start);

      return song;
    } catch (e) {
      if (!(e instanceof Error)) {
        console.error('Unexpected event occurred while fetching skip segments : ', e);
        return song;
      }

      if (!e.message.includes('404')) {
        // Don't log 404 response, it just means that there are no segments for given video
        console.warn(`Could not fetch skip segments for "${song.url}" :`, e);
      }

      if (e.message.includes('504')) {
        // Stop fetching SponsorBlock data when servers are down
        this.sponsorBlockDisabledUntil = new Date(new Date().getTime() + (this.sponsorBlockTimeoutDelay * 60_000));
      }

      return song;
    }
  }
}
