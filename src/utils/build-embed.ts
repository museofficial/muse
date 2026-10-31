import getYouTubeID from 'get-youtube-id';
import {EmbedBuilder} from 'discord.js';
import type Player from '../services/player.js';
import {MediaSource, STATUS, type QueuedSong} from '../services/player-types.js';
import getProgressBar from './get-progress-bar.js';
import {prettyTime} from './time.js';
import {truncate} from './string.js';
import {LocalizedError, t, tCount} from '../i18n/index.js';

const getMaxSongTitleLength = (title: string) => {
  // eslint-disable-next-line no-control-regex
  const nonASCII = /[^\x00-\x7F]+/;
  return nonASCII.test(title) ? 28 : 48;
};

const getSongTitle = ({title, url, offset, source}: QueuedSong, shouldTruncate = false) => {
  const cleanSongTitle = source === MediaSource.HLS ? title : title.replace(/\[.*\]/, '').trim();
  const songTitle = truncate(cleanSongTitle, shouldTruncate ? getMaxSongTitleLength(cleanSongTitle) : 256);

  if (source === MediaSource.SoundCloud || source === MediaSource.HLS) {
    // Keep long share parameters in the playable URL without overflowing Discord embeds.
    return url.length > 1024 ? songTitle : `[${songTitle}](${url})`;
  }

  const youtubeId = url.length === 11 ? url : getYouTubeID(url) ?? '';

  return `[${songTitle}](https://www.youtube.com/watch?v=${youtubeId}${offset === 0 ? '' : '&t=' + String(offset)})`;
};

const setBoundedFooter = (message: EmbedBuilder, text: string) => {
  const {title = '', description = '', fields = []} = message.data;
  const contentLength = title.length + description.length
    + fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
  // Discord also limits the combined text of an embed to 6000 characters.
  message.setFooter({text: truncate(text, Math.min(2048, 6000 - contentLength))});
};

const getQueueInfo = (player: Player, locale?: string) => {
  const queueSize = player.queueSize();
  if (queueSize === 0) {
    return '-';
  }

  return tCount(locale, 'embed.songCount', queueSize);
};

const getPlayerUI = (player: Player, locale?: string) => {
  const song = player.getCurrent();

  if (!song) {
    return '';
  }

  const position = player.getPosition();
  const button = player.status === STATUS.PLAYING ? '⏹️' : '▶️';
  // Ninety-one narrow rail positions fit in about the same visual width as the
  // original ten-glyph bar, while allowing five-second motion on most songs.
  const progressBar = getProgressBar(91, position / song.length);
  const elapsedTime = song.isLive ? t(locale, 'embed.live') : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const loop = player.loopCurrentSong ? '🔂' : player.loopCurrentQueue ? '🔁' : '';
  const vol: string = typeof player.getVolume() === 'number' ? `${player.getVolume()!}%` : '';
  // Keep the slider outside inline code so Discord renders its emoji and rail
  // graphically, matching the original Muse playback UI.
  return `${button} ${progressBar} \`[${elapsedTime}]\`🔉 ${vol} ${loop}`;
};

export const buildPlayingMessageEmbed = (player: Player, locale?: string): EmbedBuilder => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('No playing song found');
  }

  const {artist, thumbnailUrl, requestedBy} = currentlyPlaying;
  const message = new EmbedBuilder();
  message
    .setColor(player.status === STATUS.PLAYING ? 'DarkGreen' : 'DarkRed')
    .setTitle(t(locale, player.status === STATUS.PLAYING ? 'embed.nowPlaying' : 'embed.paused'))
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      ${t(locale, 'embed.requestedBy', {user: requestedBy})}\n
      ${getPlayerUI(player, locale)}
    `);
  setBoundedFooter(message, t(locale, 'embed.source', {artist}));

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildQueueEmbed = (player: Player, page: number, pageSize: number, locale?: string): EmbedBuilder => {
  if (page < 1) {
    throw new LocalizedError('embed.error.pageTooLow');
  }

  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new LocalizedError('embed.error.queueEmpty');
  }

  const queueSize = player.queueSize();
  const maxQueuePage = Math.max(1, Math.ceil(queueSize / pageSize));

  if (page > maxQueuePage) {
    throw new LocalizedError('embed.error.pageTooHigh');
  }

  const queuePageBegin = (page - 1) * pageSize;
  const queuePageEnd = queuePageBegin + pageSize;
  const queuedSongs = player
    .getQueue()
    .slice(queuePageBegin, queuePageEnd)
    .map((song, index) => {
      const songNumber = index + 1 + queuePageBegin;
      const duration = song.isLive ? t(locale, 'embed.live') : prettyTime(song.length);

      return `\`${songNumber}.\` ${getSongTitle(song, true)} \`[${duration}]\``;
    });

  const {artist, thumbnailUrl, playlist, requestedBy} = currentlyPlaying;
  const playlistTitle = playlist ? t(locale, 'embed.playlist', {title: playlist.title}) : '';
  const totalLength = player.getQueue().reduce((accumulator, current) => accumulator + current.length, 0);

  const message = new EmbedBuilder();

  let description = `**${getSongTitle(currentlyPlaying)}**\n`;
  description += `${t(locale, 'embed.requestedBy', {user: requestedBy})}\n\n`;
  description += `${getPlayerUI(player, locale)}\n\n`;

  if (player.getQueue().length > 0) {
    description += `${t(locale, 'embed.upNext')}\n`;
    for (const [index, song] of queuedSongs.entries()) {
      // Leave room for a useful hint instead of rejecting the entire /queue response.
      const overflowMessage = t(locale, 'embed.overflow', {count: queuedSongs.length - index});
      if (description.length + song.length + 1 + overflowMessage.length > 4096) {
        description += overflowMessage;
        break;
      }

      description += `${song}\n`;
    }
  }

  const title = player.status === STATUS.PLAYING
    ? t(locale, player.loopCurrentSong ? 'embed.nowPlayingLooped' : 'embed.nowPlaying')
    : t(locale, 'embed.queued');

  message
    .setTitle(title)
    .setColor(player.status === STATUS.PLAYING ? 'DarkGreen' : 'NotQuiteBlack')
    .setDescription(description)
    .addFields([{name: t(locale, 'embed.inQueue'), value: getQueueInfo(player, locale), inline: true}, {
      name: t(locale, 'embed.totalLength'), value: `${totalLength > 0 ? prettyTime(totalLength) : '-'}`, inline: true,
    }, {name: t(locale, 'embed.page'), value: t(locale, 'embed.pageOf', {page, total: maxQueuePage}), inline: true}]);
  setBoundedFooter(message, t(locale, 'embed.queueSource', {artist, playlist: playlistTitle}));

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};
