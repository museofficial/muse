import {SlashCommandBuilder} from '@discordjs/builders';
import {ButtonInteraction, CommandInteraction} from 'discord.js';

export default class Command {
  // TODO: remove
  name?: string;
  aliases?: string[];
  examples?: string[][];
  readonly slashCommand?: Partial<SlashCommandBuilder> & Pick<SlashCommandBuilder, 'toJSON'>;
  readonly handledButtonIds?: readonly string[];
  readonly requiresVC?: boolean;
  executeFromInteraction?: (interaction: CommandInteraction) => Promise<void>;
  handleButtonInteraction?: (interaction: ButtonInteraction) => Promise<void>;
}
