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
      .map(c => `**/${c.slashCommand.name ?? ''}** — ${c.slashCommand.description ?? ''}`)
      .join('\n');

    const usage = [
      '**Listening sessions**',
      'Add music with `/play`. Your confirmation is private; the shared card shows playback and controls.',
      'When the queue ends, the card keeps the songs that played. Use **View full history** for the complete list.',
      '',
      '**Favorites**',
      'A favorite saves a named search or track/playlist URL for this server, not audio or a copy of the queue.',
      'Create one with `/favorites create name:lofi query:lofi hip hop`, then play it with `/favorites use name:lofi`.',
      'Use `/favorites list` to see this server\'s favorites.',
      '',
      '**Leaving after the queue ends**',
      '`/config set-wait-after-queue-empties delay:60` waits 60 seconds before leaving voice.',
      'Set `delay:0` to never leave because the queue is empty. `/config set-leave-if-no-listeners` is a separate setting.',
    ].join('\n');

    await interaction.reply({content: `${commandList}\n\n${usage}`, ephemeral: true});
  }
}
