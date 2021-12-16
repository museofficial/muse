import {CommandInteraction, MessageActionRow, MessageButton, MessageEmbed} from 'discord.js';
import getYouTubeID from 'get-youtube-id';
import getProgressBar from '../utils/get-progress-bar.js';
import {prettyTime} from '../utils/time.js';
import Player, {STATUS} from './player.js';

const PAGE_SIZE = 10;

const REFRESH_INTERVAL_MS = 5 * 1000;

export enum BUTTON_IDS {
  PAGE_BACK = 'page-back',
  PAGE_FORWARD = 'page-forward',
  TRACK_BACK = 'track-back',
  TRACK_FORWARD = 'track-forward',
  PAUSE = 'pause',
  PLAY = 'play',
}

export default class {
  private readonly player: Player;
  private interaction?: CommandInteraction;

  // 1-indexed
  private currentPage = 1;

  private refreshTimeout?: NodeJS.Timeout;

  constructor(player: Player) {
    this.player = player;

    this.addEventHandlers();
  }

  /**
   * Creates & replies with a new embed from the given interaction.
   * Starts updating the embed at a regular interval.
   * Can be called multiple times within the lifecycle of this class.
   * Calling this method will make it forgot the previous interaction & reply.
   * @param interaction
   */
  async createFromInteraction(interaction: CommandInteraction) {
    this.interaction = interaction;
    this.currentPage = 1;

    await interaction.reply({
      embeds: [this.buildEmbed()],
      components: this.buildButtons(this.player),
    });

    if (!this.refreshTimeout) {
      this.refreshTimeout = setInterval(async () => this.update(), REFRESH_INTERVAL_MS);
    }
  }

  async update(shouldResetPage = false) {
    if (shouldResetPage) {
      this.currentPage = 1;
    }

    await this.interaction?.editReply({
      embeds: [this.buildEmbed()],
      components: this.buildButtons(this.player),
    });
  }

  async pageBack() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }

    await this.update();
  }

  async pageForward() {
    if (this.currentPage < this.getMaxPage()) {
      this.currentPage++;
    }

    await this.update();
  }

  private buildButtons(player: Player): MessageActionRow[] {
    const queuePageControls = new MessageActionRow()
      .addComponents(
        new MessageButton()
          .setCustomId(BUTTON_IDS.PAGE_BACK)
          .setStyle('SECONDARY')
          .setDisabled(this.currentPage === 1)
          .setEmoji('⬅️'),

        new MessageButton()
          .setCustomId(BUTTON_IDS.PAGE_FORWARD)
          .setStyle('SECONDARY')
          .setDisabled(this.currentPage >= this.getMaxPage())
          .setEmoji('➡️'),
      );

    const components = [];

    components.push(
      new MessageButton()
        .setCustomId(BUTTON_IDS.TRACK_BACK)
        .setStyle('PRIMARY')
        .setDisabled(!player.canGoBack())
        .setEmoji('⏮'));

    if (player.status === STATUS.PLAYING) {
      components.push(
        new MessageButton()
          .setCustomId(BUTTON_IDS.PAUSE)
          .setStyle('PRIMARY')
          .setDisabled(!player.getCurrent())
          .setEmoji('⏸️'));
    } else {
      components.push(
        new MessageButton()
          .setCustomId(BUTTON_IDS.PLAY)
          .setStyle('PRIMARY')
          .setDisabled(!player.getCurrent())
          .setEmoji('▶️'));
    }

    components.push(
      new MessageButton()
        .setCustomId(BUTTON_IDS.TRACK_FORWARD)
        .setStyle('PRIMARY')
        .setDisabled(!player.canGoForward(1))
        .setEmoji('⏭'),
    );

    const playerControls = new MessageActionRow().addComponents(components);

    return [queuePageControls, playerControls];
  }

  /**
   * Generates an embed for the current page of the queue.
   * @returns MessageEmbed
   */
  private buildEmbed() {
    const currentlyPlaying = this.player.getCurrent();

    if (!currentlyPlaying) {
      throw new Error('queue is empty');
    }

    const queueSize = this.player.queueSize();

    if (this.currentPage > this.getMaxPage()) {
      throw new Error('the queue isn\'t that big');
    }

    const embed = new MessageEmbed();

    embed.setTitle(currentlyPlaying.title);
    embed.setURL(`https://www.youtube.com/watch?v=${currentlyPlaying.url.length === 11 ? currentlyPlaying.url : getYouTubeID(currentlyPlaying.url) ?? ''}`);

    let description = getProgressBar(20, this.player.getPosition() / currentlyPlaying.length);
    description += ' ';
    description += `\`[${prettyTime(this.player.getPosition())}/${currentlyPlaying.isLive ? 'live' : prettyTime(currentlyPlaying.length)}]\``;
    description += ' 🔉';
    description += this.player.isQueueEmpty() ? '' : '\n\n**Next up:**';

    embed.setDescription(description);

    let footer = `Source: ${currentlyPlaying.artist}`;

    if (currentlyPlaying.playlist) {
      footer += ` (${currentlyPlaying.playlist.title})`;
    }

    embed.setFooter(footer);

    const queuePageBegin = (this.currentPage - 1) * PAGE_SIZE;
    const queuePageEnd = queuePageBegin + PAGE_SIZE;

    this.player.getQueue().slice(queuePageBegin, queuePageEnd).forEach((song, i) => {
      embed.addField(`${(i + 1 + queuePageBegin).toString()}/${queueSize.toString()}`, song.title, false);
    });

    embed.addField('Page', `${this.currentPage} out of ${this.getMaxPage()}`, false);

    return embed;
  }

  private getMaxPage() {
    return Math.ceil((this.player.queueSize() + 1) / PAGE_SIZE);
  }

  private addEventHandlers() {
    this.player.on('statusChange', async () => this.update(true));

    // TODO: also update on other player events
  }
}
