import getYouTubeID from 'get-youtube-id';
import {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} from 'discord.js';
import Player, {MediaSource, QueuedSong, STATUS} from '../services/player.js';
import getProgressBar from './get-progress-bar.js';
import {prettyTime} from './time.js';
import {truncate} from './string.js';

export const MUSIC_BUTTON_IDS = {
  replay: 'music:replay',
  pauseResume: 'music:pause-resume',
  skip: 'music:skip',
  stop: 'music:stop',
  loopSong: 'music:loop-song',
  loopQueue: 'music:loop-queue',
  shuffle: 'music:shuffle',
  queue: 'music:queue',
} as const;

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

  return queueSize === 1 ? '1 song' : `${queueSize} songs`;
};

const getLoopLabel = (player: Player) => {
  if (player.loopCurrentSong) {
    return 'Song';
  }

  if (player.loopCurrentQueue) {
    return 'Queue';
  }

  return 'Off';
};

const getPlayerUI = (player: Player) => {
  const song = player.getCurrent();

  if (!song) {
    return '';
  }

  const position = player.getPosition();
  const button = player.status === STATUS.PLAYING ? '⏹️' : '▶️';
  const progressBar = getProgressBar(10, position / song.length);
  const elapsedTime = song.isLive ? 'live' : `${prettyTime(position)}/${prettyTime(song.length)}`;
  const loop = player.loopCurrentSong ? '🔂' : player.loopCurrentQueue ? '🔁' : '';
  const vol: string = typeof player.getVolume() === 'number' ? `${player.getVolume()!}%` : '';
  return `${button} ${progressBar} \`[${elapsedTime}]\`🔉 ${vol} ${loop}`;
};

export const buildPlayingMessageEmbed = (player: Player): EmbedBuilder => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('No playing song found');
  }

  const {artist, thumbnailUrl, requestedBy} = currentlyPlaying;
  const message = new EmbedBuilder();
  message
    .setColor(player.status === STATUS.PLAYING ? 'DarkGreen' : 'DarkRed')
    .setTitle(player.status === STATUS.PLAYING ? 'Now Playing' : 'Paused')
    .setDescription(`
      **${getSongTitle(currentlyPlaying)}**
      Requested by: <@${requestedBy}>\n
      ${getPlayerUI(player)}
    `)
    .setFooter({text: `Source: ${artist}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

export const buildPlayerControlRows = (player: Player): Array<ActionRowBuilder<ButtonBuilder>> => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.replay)
      .setLabel('Restart')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.pauseResume)
      .setLabel(player.status === STATUS.PLAYING ? 'Pause' : 'Resume')
      .setStyle(player.status === STATUS.PLAYING ? ButtonStyle.Primary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.skip)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.stop)
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger),
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.loopSong)
      .setLabel(`Repeat Song: ${player.loopCurrentSong ? 'On' : 'Off'}`)
      .setStyle(player.loopCurrentSong ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.loopQueue)
      .setLabel(`Repeat Queue: ${player.loopCurrentQueue ? 'On' : 'Off'}`)
      .setStyle(player.loopCurrentQueue ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.shuffle)
      .setLabel('Shuffle')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(MUSIC_BUTTON_IDS.queue)
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary),
  ),
];

export const buildQueueEmbed = (player: Player, page: number, pageSize: number): EmbedBuilder => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('queue is empty');
  }

  const queueSize = player.queueSize();
  const maxQueuePage = Math.ceil((queueSize + 1) / pageSize);

  if (page > maxQueuePage) {
    throw new Error('the queue isn\'t that big');
  }

  const queuePageBegin = (page - 1) * pageSize;
  const queuePageEnd = queuePageBegin + pageSize;
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

  const message = new EmbedBuilder();

  let description = `**${getSongTitle(currentlyPlaying)}**\n`;
  description += `Requested by: <@${requestedBy}>\n\n`;
  description += `${getPlayerUI(player)}\n\n`;

  if (player.getQueue().length > 0) {
    description += '**Up next:**\n';
    description += queuedSongs;
  }

  message
    .setTitle(player.status === STATUS.PLAYING ? 'Now Playing' : 'Queued Songs')
    .setColor(player.status === STATUS.PLAYING ? 0x00E5A8 : 0x5865F2)
    .setDescription(description)
    .addFields([{name: 'In queue', value: getQueueInfo(player), inline: true}, {
      name: 'Total length', value: `${totalLength > 0 ? prettyTime(totalLength) : '-'}`, inline: true,
    }, {name: 'Page', value: `${page} out of ${maxQueuePage}`, inline: true}, {name: 'Repeat', value: getLoopLabel(player), inline: true}])
    .setFooter({text: `Source: ${artist} ${playlistTitle}`});

  if (thumbnailUrl) {
    message.setThumbnail(thumbnailUrl);
  }

  return message;
};

