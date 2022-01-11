import {MessageEmbed, TextBasedChannel} from 'discord.js';
import player, {QueuedSong} from '../services/player.js';
import {prettyTime} from './time.js';

export const announceCurrentSong = async (player: player, channel: TextBasedChannel): Promise<void> => {
  const currentSong = player.getCurrent();
  if (currentSong) {
    await channel.send({embeds: [buildMessage(currentSong)]});
  }
};

const buildMessage = (song: QueuedSong): MessageEmbed => {
  const message = new MessageEmbed();

  if (song.thumbnailUrl) {
    message.setThumbnail(song.thumbnailUrl);
  }

  message
    .setColor('DARK_GREEN')
    .setTitle('Now Playing')
    .setDescription(`[${song.title}](https://www.youtube.com/watch?v=${song.url})`)
    .addFields([
      {
        name: 'Song Duration',
        value: prettyTime(song.length),
        inline: true,
      },
      {
        name: 'Requested by',
        value: `<@${song.requestedBy}>`,
        inline: true,
      },
    ]);

  return message;
};
