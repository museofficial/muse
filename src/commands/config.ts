import {TextChannel, Message, GuildChannel, ThreadChannel} from 'discord.js';
import {injectable} from 'inversify';
import {Settings} from '../models/index.js';
import errorMsg from '../utils/error-msg.js';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'config';
  public aliases = [];
  public examples = [
    ['config prefix !', 'set the prefix to !'],
    ['config channel music-commands', 'bind the bot to the music-commands channel'],
    ['config playlist-limit 30', 'set the playlist song limit to 30'],
  ];

  public async execute(msg: Message, args: string []): Promise<void> {
    if (args.length === 0) {
      // Show current settings
      const settings = await Settings.findByPk(msg.guild!.id);

      if (settings) {
        let response = `prefix: \`${settings.prefix}\`\n`;
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        response += `channel: ${msg.guild!.channels.cache.get(settings.channel)!.toString()}\n`;
        response += `playlist-limit: ${settings.playlistLimit}`;

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

        await Settings.update({prefix: newPrefix}, {where: {guildId: msg.guild!.id}});

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
          await Settings.update({channel: channel.id}, {where: {guildId: msg.guild!.id}});

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

        await Settings.update({playlistLimit}, {where: {guildId: msg.guild!.id}});
        await msg.channel.send(`👍 playlist-limit updated to ${playlistLimit}`);
        break;
      }

      default:
        await msg.channel.send(errorMsg('I\'ve never met this setting in my life'));
    }
  }
}
