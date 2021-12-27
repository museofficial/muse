import {CommandInteraction, Message, TextChannel} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from '.';
import LoadingMessage from '../utils/loading-message.js';
import errorMsg from '../utils/error-msg.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public name = 'skip';
  public aliases = ['s'];
  public examples = [
    ['skip', 'skips the current song'],
    ['skip 2', 'skips the next 2 songs'],
  ];

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('skip')
  // TODO: make sure verb tense is consistent between all command descriptions
    .setDescription('skips  the next songs')
    .addIntegerOption(option => option
      .setName('number')
      .setDescription('number of songs to skip [default: 1]')
      .setRequired(false));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executeFromInteraction(interaction: CommandInteraction): Promise<void> {
    const numToSkip = interaction.options.getInteger('skip') ?? 1;

    if (numToSkip < 1) {
      await interaction.reply({content: errorMsg('invalid number of songs to skip'), ephemeral: true});
    }

    const player = this.playerManager.get(interaction.guild!.id);

    try {
      await player.forward(numToSkip);
      await interaction.reply('keep \'er movin\'');
    } catch (_: unknown) {
      await interaction.reply({content: errorMsg('invalid number of songs to skip'), ephemeral: true});
    }
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    let numToSkip = 1;

    if (args.length === 1) {
      if (!Number.isNaN(parseInt(args[0], 10))) {
        numToSkip = parseInt(args[0], 10);
      }
    }

    const player = this.playerManager.get(msg.guild!.id);

    const loader = new LoadingMessage(msg.channel as TextChannel);

    try {
      await loader.start();
      await player.forward(numToSkip);

      await loader.stop('keep \'er movin\'');
    } catch (_: unknown) {
      await loader.stop(errorMsg('no song to skip to'));
    }
  }
}
