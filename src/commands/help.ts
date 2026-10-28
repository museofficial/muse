import {ChatInputCommandInteraction} from 'discord.js';
import {injectable} from 'inversify';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('help'));

  private commands: Command[] = [];

  public setCommands(commands: Command[]) {
    this.commands = commands;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const {locale} = interaction;
    const commandList = this.commands
      .map(({slashCommand}) => {
        const json = slashCommand.toJSON();
        const names: Partial<Record<string, string | null>> = json.name_localizations ?? {};
        const translated: Partial<Record<string, string | null>> = json.description_localizations ?? {};
        const description = 'description' in json ? json.description : '';
        return `**/${names[locale] ?? json.name}** — ${translated[locale] ?? description}`;
      })
      .join('\n');

    const usage = t(interaction.locale, 'help.usage');

    await interaction.reply({content: `${commandList}\n\n${usage}`, ephemeral: true});
  }
}
