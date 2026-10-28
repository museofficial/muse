import {injectable} from 'inversify';
import Skip from './skip.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class extends Skip {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('next'));
}
