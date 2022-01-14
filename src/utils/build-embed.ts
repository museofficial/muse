import getYouTubeID from 'get-youtube-id';
import {MessageEmbed} from 'discord.js';
import Player, {QueuedSong, STATUS} from '../services/player.js';
import getProgressBar from './get-progress-bar.js';
import {prettyTime} from './time.js';

const PAGE_SIZE = 10;

const getSongTitle = ({title, url}: QueuedSong) => {
  const youtubeId = url.length === 11 ? url : getYouTubeID(url) ?? '';
  return `[${title}](https://www.youtube.com/watch?v=${youtubeId})`;
};

const getPlayerUI = (player: Player) => {
  const song = player.getCurrent();
  if (!song) {
    return '';
  }

  const button = player.status === STATUS.PLAYING ? '⏹️' : '▶️';
  const progressBar = getProgressBar(15, player.getPosition() / song.length);
  const elapsedTime = `${prettyTime(player.getPosition())}/${song.isLive ? 'live' : prettyTime(song.length)}`;

  return `${button} ${progressBar} \`[${elapsedTime}]\` 🔉`;
};

export const buildPlayingMessageEmbed = (player: Player): MessageEmbed => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('No playing song found');
  }

  const {artist, thumbnailUrl} = currentlyPlaying;
  const message = new MessageEmbed();

  message
    .setColor('DARK_GREEN')
    .setTitle('Now Playing')
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      Requested by: <@${currentlyPlaying.requestedBy}>\n
      ${getPlayerUI(player)}
    `)
    .setFooter({text: `Source: ${artist}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildQueueEmbed = (player: Player, page: number): MessageEmbed => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('queue is empty');
  }

  const queueSize = player.queueSize();
  const maxQueuePage = Math.ceil((queueSize + 1) / PAGE_SIZE);

  if (page > maxQueuePage) {
    throw new Error('the queue isn\'t that big');
  }

  const queuePageBegin = (page - 1) * PAGE_SIZE;
  const queuePageEnd = queuePageBegin + PAGE_SIZE;
  const queuedSongs = player
    .getQueue()
    .slice(queuePageBegin, queuePageEnd)
    .map((song, index) => `\`${index + 1 + queuePageBegin}.\` ${getSongTitle(song)} \`[${prettyTime(song.length)}]\``)
    .join('\n');

  const {artist, thumbnailUrl, playlist, requestedBy} = currentlyPlaying;
  const playlistTitle = playlist ? `(${playlist.title})` : '';
  const totalLength = player.getQueue().reduce((accumulator, current) => accumulator + current.length, 0);

  const message = new MessageEmbed();

  message
    .setTitle(player.status === STATUS.PLAYING ? 'Now Playing' : 'Queued songs')
    .setColor(player.status === STATUS.PLAYING ? 'DARK_GREEN' : 'NOT_QUITE_BLACK')
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      Requested by: <@${requestedBy}>\n
      ${getPlayerUI(player)}\n
      **Up next:**
      ${queuedSongs}
    `)
    .addField('In queue', `${queueSize} songs`, true)
    .addField('Total length', `${prettyTime(totalLength)}`, true)
    .addField('Page', `${page} out of ${maxQueuePage}`, true)
    .setFooter({text: `Source: ${artist} ${playlistTitle}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};
