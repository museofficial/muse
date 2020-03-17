import {Message} from 'discord.js';
import {injectable} from 'inversify';
import Command from '.';
import {TYPES} from '../types';
import {Settings} from '../models';
import container from '../inversify.config';

@injectable()
export default class implements Command {
  public name = 'help';
  public examples = [
    ['help', 'you don\'t need a description']
  ];

  private commands: Command[] = [];

  public async execute(msg: Message, _: string []): Promise<void> {
    if (this.commands.length === 0) {
      // Lazy load to avoid circular dependencies
      this.commands = container.getAll<Command>(TYPES.Command);
    }

    const settings = await Settings.findOne({where: {guildId: msg.guild!.id}});

    if (!settings) {
      return;
    }

    const {prefix} = settings;

    const res = this.commands.sort((a, b) => a.name.localeCompare(b.name)).reduce((content, command) => {
      content += `**${command.name}**:\n`;

      command.examples.forEach(example => {
        content += `- \`${prefix}${example[0]}\`: ${example[1]}\n`;
      });

      content += '\n';

      return content;
    }, '');

    await msg.author.send(res);
    await msg.react('🇩');
    await msg.react('🇲');
  }
}
