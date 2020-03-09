import {TextChannel} from 'discord.js';
import {CommandHandler} from '../interfaces';
import {Settings} from '../models';

const config: CommandHandler = {
  name: 'config',
  description: 'Change various bot settings.',
  execute: async (msg, args) => {
    if (args.length === 0) {
      // Show current settings
      const settings = await Settings.findByPk(msg.guild!.id);

      if (settings) {
        let response = `prefix: \`${settings.prefix}\`\n`;
        response += `channel: ${msg.guild!.channels.cache.get(settings.channel)!.toString()}`;

        await msg.channel.send(response);
      }

      return;
    }

    const setting = args[0];

    if (args.length !== 2) {
      await msg.channel.send('🚫 incorrect number of arguments');
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
        const channel = msg.guild!.channels.cache.find(c => c.name === args[1]);

        if (channel && channel.type === 'text') {
          await Settings.update({channel: channel.id}, {where: {guildId: msg.guild!.id}});

          await Promise.all([
            (channel as TextChannel).send('hey apparently I\'m bound to this channel now'),
            msg.react('👍')
          ]);
        } else {
          await msg.channel.send('🚫 either that channel doesn\'t exist or you want me to become sentient and listen to a voice channel');
        }

        break;
      }

      default:
        await msg.channel.send('🚫 I\'ve never met this setting in my life');
    }
  }
};

export default config;
