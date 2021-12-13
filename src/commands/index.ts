import {SlashCommandBuilder} from '@discordjs/builders';
import {CommandInteraction} from 'discord.js';

export default interface Command {
  // TODO: remove
  name?: string;
  aliases?: string[];
  examples?: string[][];
  slashCommand?: Partial<SlashCommandBuilder> & Pick<SlashCommandBuilder, 'toJSON'>;
  requiresVC?: boolean;
  executeFromInteraction?: (interaction: CommandInteraction) => Promise<void>;
}
