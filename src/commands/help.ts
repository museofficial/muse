import {ChatInputCommandInteraction} from 'discord.js';
import {injectable} from 'inversify';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription('shows all available commands');

  private commands: Command[] = [];

  public setCommands(commands: Command[]) {
    this.commands = commands;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandList = this.commands
      .map(c => `**/${c.slashCommand.name}** — ${c.slashCommand.description}`)
      .join('\n');

    await interaction.reply({content: commandList, ephemeral: true});
  }
}
