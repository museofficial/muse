import {Message} from 'discord.js';

export default interface Command {
  name: string;
  examples: string[][];
  execute: (msg: Message, args: string[]) => Promise<void>;
}
