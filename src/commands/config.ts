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
  ];

  public async execute(msg: Message, args: string []): Promise<void> {
    if (args.length === 0) {
      // Show current settings
      const settings = await Settings.findByPk(msg.guild!.id);

      if (settings) {
        let response = `prefix: \`${settings.prefix}\`\n`;
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        response += `channel: ${msg.guild!.channels.cache.get(settings.channel)!.toString()}`;

        await msg.channel.send(response);
      }

      return;
    }

    const setting = args[0];

    if (args.length !== 2) {
      await msg.channel.send(errorMsg('This command requires two arguments.'));
      return;
    }

    if (msg.author.id !== msg.guild!.ownerId) {
      await msg.channel.send(errorMsg('You are not authorized to issue this command.'));
      return;
    }

    switch (setting) {
      case 'prefix': {
        const newPrefix = args[1];

        await Settings.update({prefix: newPrefix}, {where: {guildId: msg.guild!.id}});

        await msg.channel.send(`Prefix updated to \`${newPrefix}\``);
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
            (channel as TextChannel).send('I\'m now bound and listening to this channel.'),
          ]);
        } else {
          await msg.channel.send(errorMsg('I\'m not able to bind or listen to this channel.'));
        }

        break;
      }

      default:
        await msg.channel.send(errorMsg('I don\'t recognize this setting.'));
    }
  }
}
