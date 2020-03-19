import {Message} from 'discord.js';

export default interface Command {
  name: string;
  aliases: string[];
  examples: string[][];
  requiresVC?: boolean;
  execute: (msg: Message, args: string[]) => Promise<void>;
}
