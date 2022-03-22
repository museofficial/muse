import getYouTubeID from 'get-youtube-id';
import {MessageEmbed} from 'discord.js';
import Player, {MediaSource, QueuedSong, STATUS} from '../services/player.js';
import getProgressBar from './get-progress-bar.js';
import {prettyTime} from './time.js';
import {truncate} from './string.js';

const PAGE_SIZE = 10;

const getMaxSongTitleLength = (title: string) => {
  // eslint-disable-next-line no-control-regex
  const nonASCII = /[^\x00-\x7F]+/;
  return nonASCII.test(title) ? 28 : 48;
};

const getSongTitle = ({title, url, offset, source}: QueuedSong, shouldTruncate = false) => {
  if (source === MediaSource.HLS) {
    return `[${title}](${url})`;
  }

  const cleanSongTitle = title.replace(/\[.*\]/, '').trim();

  const songTitle = shouldTruncate ? truncate(cleanSongTitle, getMaxSongTitleLength(cleanSongTitle)) : cleanSongTitle;
  const youtubeId = url.length === 11 ? url : getYouTubeID(url) ?? '';

  return `[${songTitle}](https://www.youtube.com/watch?v=${youtubeId}${offset === 0 ? '' : '&t=' + String(offset)})`;
};

const getQueueInfo = (player: Player) => {
  const queueSize = player.queueSize();
  if (queueSize === 0) {
    return '-';
  }

  return queueSize === 1 ? '1 Song' : `${queueSize} Songs`;
};

const getPlayerUI = (player: Player) => {
  const song = player.getCurrent();

  if (!song) {
    return '';
  }

  const position = player.getPosition();
  const button = player.status === STATUS.PLAYING ? '⏹️' : '▶️';
  const progressBar = getProgressBar(15, position / song.length);
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;

  return `${button} ${progressBar} \`[${elapsedTime}]\` 🔉`;
};

export const buildPlayingMessageEmbed = (player: Player): MessageEmbed => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('Es gibt nichts zum abspielen!');
  }

  const {artist, thumbnailUrl, requestedBy} = currentlyPlaying;
  const message = new MessageEmbed();

  message
    .setColor(player.status === STATUS.PLAYING ? 'DARK_GREEN' : 'DARK_RED')
    .setTitle(player.status === STATUS.PLAYING ? 'Aktuell wird gespielt:' : 'Pausiert')
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      Gefordert von: <@${requestedBy}>
	  Beschwert euch bei der Person!\n
      ${getPlayerUI(player)}
    `)
    .setFooter({text: `Quelle: ${artist}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildQueueEmbed = (player: Player, page: number): MessageEmbed => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('Die Queue ist leer, gib mir Arbeit!');
  }

  const queueSize = player.queueSize();
  const maxQueuePage = Math.ceil((queueSize + 1) / PAGE_SIZE);

  if (page > maxQueuePage) {
    throw new Error('So groß ist die Queue jetzt auch wieder nicht!');
  }

  const queuePageBegin = (page - 1) * PAGE_SIZE;
  const queuePageEnd = queuePageBegin + PAGE_SIZE;
  const queuedSongs = player
    .getQueue()
    .slice(queuePageBegin, queuePageEnd)
    .map((song, index) => {
      const songNumber = index + 1 + queuePageBegin;
      const duration = song.isLive ? 'live' : prettyTime(song.length);

      return `\`${songNumber}.\` ${getSongTitle(song, true)} \`[${duration}]\``;
    })
    .join('\n');

  const {artist, thumbnailUrl, playlist, requestedBy} = currentlyPlaying;
  const playlistTitle = playlist ? `(${playlist.title})` : '';
  const totalLength = player.getQueue().reduce((accumulator, current) => accumulator + current.length, 0);

  const message = new MessageEmbed();

  let description = `**${getSongTitle(currentlyPlaying)}**\n`;
  description += `Gefordert von: <@${requestedBy}>\nBeschwert euch bei der Person!\n`;
  description += `${getPlayerUI(player)}\n\n`;

  if (player.getQueue().length > 0) {
    description += '**Als nächstes:**\n';
    description += queuedSongs;
  }

  message
    .setTitle(player.status === STATUS.PLAYING ? 'Aktuell wird gespielt:' : 'Gequeute Songs:')
    .setColor(player.status === STATUS.PLAYING ? 'DARK_GREEN' : 'DARK_RED')
    .setDescription(description)
    .addField('In der Queue', getQueueInfo(player), true)
    .addField('Gesamte Laufzeit', `${totalLength > 0 ? prettyTime(totalLength) : '-'}`, true)
    .addField('Seite', `${page} von ${maxQueuePage}`, true)
    .setFooter({text: `Quelle: ${artist} ${playlistTitle}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};
