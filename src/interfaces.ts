import Discord from 'discord.js';

export interface CommandHandler {
  name: string;
  description: string;
  execute: (msg: Discord.Message, args: string[]) => void;
}
