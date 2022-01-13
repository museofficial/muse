import getYouTubeID from 'get-youtube-id';
import {MessageEmbed} from 'discord.js';
import Player, {STATUS} from '../services/player.js';
import getProgressBar from './get-progress-bar.js';
import {prettyTime} from './time.js';

const PAGE_SIZE = 10;

const buildQueueEmbed = (player: Player, page: number, onlyShowCurrentSong = false) => {
  const currentlyPlaying = player.getCurrent();

  if (!currentlyPlaying) {
    throw new Error('queue is empty');
  }

  const queueSize = player.queueSize();

  const maxQueuePage = Math.ceil((queueSize + 1) / PAGE_SIZE);

  if (page > maxQueuePage) {
    throw new Error('the queue isn\'t that big');
  }

  const embed = new MessageEmbed();

  embed.setTitle('Now Playing');

  if (currentlyPlaying.thumbnailUrl) {
    embed.setThumbnail(currentlyPlaying.thumbnailUrl);
  }

  let description = `**[${currentlyPlaying.title}](https://www.youtube.com/watch?v=${currentlyPlaying.url.length === 11 ? currentlyPlaying.url : getYouTubeID(currentlyPlaying.url) ?? ''})**\n`;
  description += `(requested by: <@${currentlyPlaying.requestedBy}>)\n\n`;

  description += player.status === STATUS.PLAYING ? '⏹️' : '▶️';
  description += ' ';
  description += getProgressBar(15, player.getPosition() / currentlyPlaying.length);
  description += ' ';
  description += `\`[${prettyTime(player.getPosition())}/${currentlyPlaying.isLive ? 'live' : prettyTime(currentlyPlaying.length)}]\``;
  description += ' 🔉';

  description += '\n\n';

  embed.setDescription(description);

  let footer = `Source: ${currentlyPlaying.artist}`;

  if (currentlyPlaying.playlist) {
    footer += ` (${currentlyPlaying.playlist.title})`;
  }

  embed.setFooter({text: footer});

  if (!onlyShowCurrentSong) {
    const queuePageBegin = (page - 1) * PAGE_SIZE;
    const queuePageEnd = queuePageBegin + PAGE_SIZE;

    player.getQueue().slice(queuePageBegin, queuePageEnd).forEach((song, i) => {
      let label = `${(i + 1 + queuePageBegin).toString()}/${queueSize.toString()}`;

      if (i === 0) {
        label = 'Up next:';
      }

      embed.addField(label, song.title, false);
    });

    embed.addField('Page', `${page} out of ${maxQueuePage}`, false);
  }

  return embed;
};

export default buildQueueEmbed;
