import {TextChannel, Message, GuildChannel, ThreadChannel} from 'discord.js';
import {injectable} from 'inversify';
import errorMsg from '../utils/error-msg.js';
import Command from '.';
import {prisma} from '../utils/db.js';

@injectable()
export default class implements Command {
  public name = 'config';
  public aliases = [];
  public examples = [
    ['config prefix !', 'set the prefix to !'],
    ['config channel music-commands', 'bind the bot to the music-commands channel'],
    ['config playlist-limit 30', 'set the playlist song limit to 30'],
    ['config announce-songs no', 'disable announcement when playing songs'],
  ];

  public async execute(msg: Message, args: string []): Promise<void> {
    if (args.length === 0) {
      // Show current settings
      const settings = await prisma.setting.findUnique({
        where: {
          guildId: msg.guild!.id,
        },
      });

      if (settings?.channel) {
        let response = `prefix: \`${settings.prefix}\`\n`;
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        response += `channel: ${msg.guild!.channels.cache.get(settings.channel)!.toString()}\n`;
        response += `playlist-limit: ${settings.playlistLimit}\n`;
        response += `announce-songs: ${settings.announceSongs ? 'yes' : 'no'}`;

        await msg.channel.send(response);
      }

      return;
    }

    const setting = args[0];

    if (args.length !== 2) {
      await msg.channel.send(errorMsg('incorrect number of arguments'));
      return;
    }

    if (msg.author.id !== msg.guild!.ownerId) {
      await msg.channel.send(errorMsg('not authorized'));
      return;
    }

    switch (setting) {
      case 'prefix': {
        const newPrefix = args[1];

        await prisma.setting.update({
          where: {
            guildId: msg.guild!.id,
          },
          data: {
            prefix: newPrefix,
          },
        });

        await msg.channel.send(`👍 prefix updated to \`${newPrefix}\``);
        break;
      }

      case 'channel': {
        let channel: GuildChannel | ThreadChannel | undefined;

        if (args[1].includes('<#') && args[1].includes('>')) {
          channel = msg.guild!.channels.cache.find(c => c.id === args[1].slice(2, args[1].indexOf('>')));
        } else {
          channel = msg.guild!.channels.cache.find(c => c.name === args[1]);
        }

        if (channel && channel.type === 'GUILD_TEXT') {
          await prisma.setting.update({
            where: {
              guildId: msg.guild!.id,
            },
            data: {
              channel: channel.id,
            },
          });

          await Promise.all([
            (channel as TextChannel).send('hey apparently I\'m bound to this channel now'),
            msg.react('👍'),
          ]);
        } else {
          await msg.channel.send(errorMsg('either that channel doesn\'t exist or you want me to become sentient and listen to a voice channel'));
        }

        break;
      }

      case 'playlist-limit': {
        const playlistLimit = parseInt(args[1], 10);
        if (playlistLimit <= 0) {
          await msg.channel.send(errorMsg('please enter a valid number'));
          return;
        }

        await prisma.setting.update({
          where: {
            guildId: msg.guild!.id,
          },
          data: {
            playlistLimit,
          },
        });

        await msg.channel.send(`👍 playlist-limit updated to ${playlistLimit}`);
        break;
      }

      case 'announce-songs': {
        const choice = args[1];
        if (choice !== 'yes' && choice !== 'no') {
          await msg.channel.send('Invalid value. please use yes / no');
          return;
        }

        const announceSongs = choice === 'yes';

        await prisma.setting.update({
          where: {
            guildId: msg.guild!.id,
          },
          data: {
            announceSongs,
          },
        });
        await msg.channel.send(announceSongs ? '👍 Song will be now be announced' : '👍 Song will no longer be announced');
        break;
      }

      default:
        await msg.channel.send(errorMsg('I\'ve never met this setting in my life'));
    }
  }
}
