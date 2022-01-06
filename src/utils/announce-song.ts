import {Client, MessageEmbed, TextChannel} from 'discord.js';
import {prisma} from '../utils/db.js';
import {QueuedSong} from '../services/player.js';
import {prettyTime} from './time.js';

export const announceSong = (discordClient: Client, guildId: string) => async (song: QueuedSong) => {
  const settings = await prisma.setting.findUnique({
    where: {
      guildId,
    },
  });

  if (settings?.announceSongs) {
    const channel = discordClient.channels.cache.get(song.addedInChannelId) as TextChannel | null;
    await channel?.send({embeds: [buildMessage(song)]});
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
