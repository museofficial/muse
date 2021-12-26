import {CommandInteraction, Message} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from '.';
import errorMsg from '../utils/error-msg.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('remove')
  // TODO: make sure verb tense is consistent between all command descriptions
    .setDescription('remove songs from the queue')
    .addIntegerOption(option =>
      option.setName('position')
        .setDescription('position of the song to remove [default: 1]')
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option.setName('range')
        .setDescription('number of songs to remove [default: 1]')
        .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async executeFromInteraction(interaction: CommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const position = interaction.options.getInteger('position') ?? 1;
    const range = interaction.options.getInteger('range') ?? 1;

    if (position < 1) {
      await interaction.reply('position must be greater than 0');
    }

    if (range < 1) {
      await interaction.reply('range must be greater than 0');
    }

    player.removeFromQueue(position, range);

    await interaction.reply(':wastebasket: removed');
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    if (args.length === 0) {
      await msg.channel.send(errorMsg('missing song position or range'));
      return;
    }

    const reg = /^(\d+)-(\d+)$|^(\d+)$/g; // Expression has 3 groups: x-y or z. x-y is range, z is a single digit.
    const match = reg.exec(args[0]);

    if (match === null) {
      await msg.channel.send(errorMsg('incorrect format'));
      return;
    }

    if (match[3] === undefined) { // 3rd group (z) doesn't exist -> a range
      const range = [parseInt(match[1], 10), parseInt(match[2], 10)];

      if (range[0] < 1) {
        await msg.channel.send(errorMsg('position must be greater than 0'));
        return;
      }

      if (range[1] > player.queueSize()) {
        await msg.channel.send(errorMsg('position is outside of the queue\'s range'));
        return;
      }

      if (range[0] < range[1]) {
        player.removeFromQueue(range[0], range[1] - range[0] + 1);
      } else {
        await msg.channel.send(errorMsg('range is backwards'));
        return;
      }
    } else { // 3rd group exists -> just one song
      const index = parseInt(match[3], 10);

      if (index < 1) {
        await msg.channel.send(errorMsg('position must be greater than 0'));
        return;
      }

      if (index > player.queueSize()) {
        await msg.channel.send(errorMsg('position is outside of the queue\'s range'));
        return;
      }

      player.removeFromQueue(index, 1);
    }

    await msg.channel.send(':wastebasket: removed');
  }
}
