import {ChatInputCommandInteraction, GuildMember} from 'discord.js';
import {inject, injectable} from 'inversify';
import shuffle from 'array-shuffle';
import {TYPES} from '../types.js';
import GetSongs from '../services/get-songs.js';
import {MediaSource, type PlayingMessageTerminalState, SongMetadata, STATUS} from './player.js';
import PlayerManager from '../managers/player.js';
import {buildQueueEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {SponsorBlock} from 'sponsorblock-api';
import Config from './config.js';
import KeyValueCacheProvider from './key-value-cache.js';
import {MUSIC_CONTROL_EMOJIS, ONE_HOUR_IN_SECONDS} from '../utils/constants.js';

const isSameQueueEntry = (capturedId: number | null, currentId: number | null) => (
  capturedId !== null && capturedId === currentId
);

const normalizeSkipError = (error: unknown) => (
  error instanceof Error && error.message === 'No songs in queue to forward to.'
    ? new Error('no song to skip to')
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
    @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
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
    const player = this.playerManager.get(guildId);
    const currentQueueEntryId = player.getCurrentQueueEntryId();
    const wasPlayingSong = currentQueueEntryId !== null;

    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await getGuildSettings(guildId);

    const {playlistLimit, queueAddResponseEphemeral, defaultQueuePageSize = 10} = settings;

    await interaction.deferReply({ephemeral: queueAddResponseEphemeral});

    let [newSongs, extraMsg] = await this.getSongs.getSongs(query, playlistLimit, shouldSplitChapters);

    if (newSongs.length === 0) {
      throw new Error('no songs found');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    if (this.config.ENABLE_SPONSORBLOCK) {
      newSongs = await Promise.all(newSongs.map(this.skipNonMusicSegments.bind(this)));
    }

    const needsConnection = player.voiceConnection === null;
    if (needsConnection) {
      // A failed join must not leave an unacknowledged request in the queue.
      await player.connect(targetVoiceChannel);
    } else {
      // Let an existing session recover without changing its channel or paused state.
      await player.ensureVoiceConnectionReady();
    }

    newSongs.forEach((song, index) => {
      player.add({
        ...song,
        addedInChannelId: interaction.channel!.id,
        requestedBy: interaction.member!.user.id,
      }, {
        immediate: addToFrontOfQueue,
        immediateOffset: index,
      });
    });

    const firstSong = newSongs[0];

    let statusMsg = '';
    let shouldShowPlayingEmbed = false;

    if (needsConnection) {
      // Resume / start playback
      await player.play();

      if (wasPlayingSong) {
        statusMsg = 'resuming playback';
      }

      shouldShowPlayingEmbed = true;
    } else if (player.status === STATUS.IDLE) {
      // Player is idle, start playback instead
      await player.play();
      shouldShowPlayingEmbed = true;
    }

    if (!player.getCurrent()) {
      throw new Error('no playable songs found');
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

    // Build response message
    if (statusMsg !== '') {
      if (extraMsg === '') {
        extraMsg = statusMsg;
      } else {
        extraMsg = `${statusMsg}, ${extraMsg}`;
      }
    }

    if (extraMsg !== '') {
      extraMsg = ` (${extraMsg})`;
    }

    const responseContent = newSongs.length === 1
      ? `u betcha, **${firstSong.title}** added to the${addToFrontOfQueue ? ' front of the' : ''} queue${didSkipCurrentTrack ? ' and current track skipped' : ''}${extraMsg}`
      : `u betcha, **${firstSong.title}** and ${newSongs.length - 1} other songs were added to the queue${didSkipCurrentTrack ? ' and current track skipped' : ''}${extraMsg}`;

    if (!shouldShowPlayingEmbed) {
      await interaction.editReply(responseContent);
      return;
    }

    // The queue embed supplies both the progress timer and the upcoming list
    // for the live response associated with this playback session.
    const response = await interaction.editReply({
      content: responseContent,
      embeds: [buildQueueEmbed(player, 1, defaultQueuePageSize)],
    });
    player.setPlayingMessageUpdater(async (terminalState?: PlayingMessageTerminalState) => {
      const update = terminalState
        ? {content: terminalState === 'stopped' ? 'Playback stopped.' : 'Playback finished.', embeds: []}
        : {embeds: [buildQueueEmbed(player, 1, defaultQueuePageSize)]};

      // Public interaction responses become regular channel messages and can
      // use Message.edit. Ephemeral responses must remain on the interaction webhook.
      if (queueAddResponseEphemeral) {
        await interaction.editReply(update);
      } else {
        await response.edit(update);
      }

      if (terminalState && !queueAddResponseEphemeral) {
        // Controls have no useful action after playback ends. Removing all
        // reactions also prevents a stale response from looking interactive.
        await response.reactions.removeAll().catch(error => {
          console.warn(`Could not remove music controls for guild ${guildId}:`, error);
        });
      }
    }, queueAddResponseEphemeral ? undefined : response.id);

    if (!queueAddResponseEphemeral) {
      // Add controls sequentially so Discord displays them in transport order.
      for (const emoji of MUSIC_CONTROL_EMOJIS) {
        try {
          // Reaction order is part of the transport-control layout.
          // eslint-disable-next-line no-await-in-loop
          await response.react(emoji);
        } catch (error: unknown) {
          console.warn(`Could not add music control ${emoji} for guild ${guildId}:`, error);
        }
      }
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
