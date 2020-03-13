import {Message} from 'discord.js';

export default interface Command {
  name: string;
  description: string;
  execute: (msg: Message, args: string[]) => Promise<void>;
}
