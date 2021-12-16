import {ButtonInteraction, CommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import UpdatingQueueEmbedManager from '../managers/updating-queue-embed.js';
import {BUTTON_IDS} from '../services/updating-queue-embed.js';
import Command from '.';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('show the current queue');

  public readonly handledButtonIds = Object.values(BUTTON_IDS);

  private readonly playerManager: PlayerManager;
  private readonly updatingQueueEmbedManager: UpdatingQueueEmbedManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Managers.UpdatingQueueEmbed) updatingQueueEmbedManager: UpdatingQueueEmbedManager) {
    this.playerManager = playerManager;
    this.updatingQueueEmbedManager = updatingQueueEmbedManager;
  }

  public async executeFromInteraction(interaction: CommandInteraction) {
    const embed = this.updatingQueueEmbedManager.get(interaction.guild!.id);

    await embed.createFromInteraction(interaction);
  }

  public async handleButtonInteraction(interaction: ButtonInteraction) {
    const player = this.playerManager.get(interaction.guild!.id);
    const embed = this.updatingQueueEmbedManager.get(interaction.guild!.id);

    const buttonId = interaction.customId as keyof typeof this.handledButtonIds;

    // Not entirely sure why this is necessary.
    // We don't wait for the Promise to resolve here to avoid blocking the
    // main logic. However, we need to wait for the Promise to be resolved before
    // throwing as otherwise a race condition pops up when bot.ts tries updating
    // the interaction.
    const deferedUpdatePromise = interaction.deferUpdate();

    try {
      switch (buttonId) {
        case BUTTON_IDS.TRACK_BACK:
          await player.back();
          break;

        case BUTTON_IDS.TRACK_FORWARD:
          await player.forward(1);
          break;

        case BUTTON_IDS.PAUSE:
          player.pause();
          break;

        case BUTTON_IDS.PLAY:
          await player.play();
          break;

        case BUTTON_IDS.PAGE_BACK:
          await embed.pageBack();
          break;

        case BUTTON_IDS.PAGE_FORWARD:
          await embed.pageForward();
          break;

        default:
          throw new Error('unknown customId');
      }
    } catch (error: unknown) {
      await deferedUpdatePromise;

      throw error;
    }
  }
}
