import {Message} from 'discord.js';

export interface CommandHandler {
  name: string;
  description: string;
  execute: (msg: Message, args: string[]) => void;
}
