import {SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder} from '@discordjs/builders';
import {AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, GuildMember} from 'discord.js';
import {inject, injectable, optional} from 'inversify';
import Spotify from 'spotify-web-api-node';
import {URL} from 'url';
import Command from './index.js';
import {TYPES} from '../types.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import PlayerManager from '../managers/player.js';
import ThirdParty from '../services/third-party.js';
import KeyValueCacheProvider from '../services/key-value-cache.js';
import {STATUS} from '../services/player.js';
import {buildPlayerControlRows, buildPlayingMessageEmbed, buildQueueEmbed, MUSIC_BUTTON_IDS} from '../utils/build-embed.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import getYouTubeAndSpotifySuggestionsFor, {SpotifySuggestionsUnavailableError} from '../utils/get-youtube-and-spotify-suggestions-for.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';

@injectable()
export default class implements Command {
  public readonly slashCommand: Partial<SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder> & Pick<SlashCommandBuilder, 'toJSON'>;
  public readonly handledButtonIds = Object.values(MUSIC_BUTTON_IDS);

  public requiresVC = (interaction: ChatInputCommandInteraction) => !['queue', 'now', 'status'].includes(interaction.options.getSubcommand());

  private readonly spotify?: Spotify;

  constructor(
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
    @inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue,
    @inject(TYPES.KeyValueCache) private readonly cache: KeyValueCacheProvider,
    @inject(TYPES.ThirdParty) @optional() thirdParty?: ThirdParty,
  ) {
    this.spotify = thirdParty?.spotify;

    const queryDescription = thirdParty === undefined
      ? 'YouTube URL or search query'
      : 'YouTube URL, Spotify URL, or search query';

    this.slashCommand = new SlashCommandBuilder()
      .setName('music')
      .setDescription('simple all-in-one music controls')
      .addSubcommand(subcommand => subcommand
        .setName('play')
        .setDescription('add music to the queue')
        .addStringOption(option => option
          .setName('query')
          .setDescription(queryDescription)
          .setAutocomplete(true)
          .setRequired(true))
        .addBooleanOption(option => option
          .setName('shuffle')
          .setDescription('shuffle the songs you add'))
        .addBooleanOption(option => option
          .setName('split')
          .setDescription('split a video into chapters when possible')))
      .addSubcommand(subcommand => subcommand
        .setName('next')
        .setDescription('play something right after the current song')
        .addStringOption(option => option
          .setName('query')
          .setDescription(queryDescription)
          .setAutocomplete(true)
          .setRequired(true)))
      .addSubcommand(subcommand => subcommand
        .setName('skip')
        .setDescription('skip one or more tracks')
        .addIntegerOption(option => option
          .setName('amount')
          .setDescription('tracks to skip')
          .setMinValue(1)))
      .addSubcommand(subcommand => subcommand.setName('restart').setDescription('restart the current track'))
      .addSubcommand(subcommand => subcommand.setName('pause').setDescription('pause playback'))
      .addSubcommand(subcommand => subcommand.setName('resume').setDescription('resume playback'))
      .addSubcommand(subcommand => subcommand.setName('stop').setDescription('stop playback and clear the queue'))
      .addSubcommand(subcommand => subcommand.setName('now').setDescription('show the current track'))
      .addSubcommand(subcommand => subcommand.setName('status').setDescription('show player mode, volume, and repeat state'))
      .addSubcommand(subcommand => subcommand
        .setName('queue')
        .setDescription('show the queue')
        .addIntegerOption(option => option
          .setName('page')
          .setDescription('queue page')
          .setMinValue(1)))
      .addSubcommand(subcommand => subcommand.setName('shuffle').setDescription('shuffle upcoming tracks'))
      .addSubcommand(subcommand => subcommand.setName('clear').setDescription('clear upcoming tracks but keep the current song'))
      .addSubcommand(subcommand => subcommand
        .setName('remove')
        .setDescription('remove one or more upcoming tracks')
        .addIntegerOption(option => option
          .setName('position')
          .setDescription('queue position to remove')
          .setMinValue(1)
          .setRequired(true))
        .addIntegerOption(option => option
          .setName('amount')
          .setDescription('number of tracks to remove')
          .setMinValue(1)))
      .addSubcommand(subcommand => subcommand
        .setName('repeat')
        .setDescription('set repeat mode')
        .addStringOption(option => option
          .setName('mode')
          .setDescription('repeat mode')
          .addChoices(
            {name: 'off', value: 'off'},
            {name: 'current song', value: 'song'},
            {name: 'queue / playlist', value: 'queue'},
          )
          .setRequired(true)))
      .addSubcommand(subcommand => subcommand
        .setName('volume')
        .setDescription('set music volume')
        .addIntegerOption(option => option
          .setName('level')
          .setDescription('0 to 100')
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)));
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    switch (interaction.options.getSubcommand()) {
      case 'play':
      case 'next': {
        await this.addQueryToQueue.addToQueue({
          interaction,
          query: interaction.options.getString('query')!.trim(),
          addToFrontOfQueue: interaction.options.getSubcommand() === 'next',
          shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
          shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
          skipCurrentTrack: false,
        });
        break;
      }

      case 'skip': {
        await player.forward(interaction.options.getInteger('amount') ?? 1);
        await interaction.reply({
          content: 'Skipped.',
          embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [],
          components: player.getCurrent() ? buildPlayerControlRows(player) : [],
        });
        break;
      }

      case 'restart': {
        if (!player.getCurrent()) {
          throw new Error('nothing is currently playing');
        }

        await player.seek(0);
        await interaction.reply({content: 'Restarted.', embeds: [buildPlayingMessageEmbed(player)], components: buildPlayerControlRows(player)});
        break;
      }

      case 'pause': {
        if (player.status !== STATUS.PLAYING) {
          throw new Error('not currently playing');
        }

        player.pause();
        await interaction.reply('Paused.');
        break;
      }

      case 'resume': {
        if (player.status === STATUS.PLAYING) {
          throw new Error('already playing');
        }

        if (!player.getCurrent()) {
          throw new Error('nothing to play');
        }

        const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);
        await player.connect(targetVoiceChannel);
        await player.play();
        await interaction.reply({content: 'Resumed.', embeds: [buildPlayingMessageEmbed(player)], components: buildPlayerControlRows(player)});
        break;
      }

      case 'stop': {
        if (!player.voiceConnection) {
          throw new Error('not connected');
        }

        player.stop();
        await interaction.reply('Stopped and cleared the queue.');
        break;
      }

      case 'now': {
        if (!player.getCurrent()) {
          throw new Error('nothing is currently playing');
        }

        await interaction.reply({embeds: [buildPlayingMessageEmbed(player)], components: buildPlayerControlRows(player)});
        break;
      }

      case 'status': {
        const repeatMode = player.loopCurrentSong ? 'current song' : player.loopCurrentQueue ? 'queue / playlist' : 'off';
        await interaction.reply([
          `Status: **${STATUS[player.status].toLowerCase()}**`,
          `Volume: **${player.getVolume()}%**`,
          `Repeat: **${repeatMode}**`,
          `Upcoming tracks: **${player.queueSize()}**`,
        ].join('\n'));
        break;
      }

      case 'queue': {
        const pageSize = (await getGuildSettings(interaction.guild!.id)).defaultQueuePageSize;
        await interaction.reply({embeds: [buildQueueEmbed(player, interaction.options.getInteger('page') ?? 1, pageSize)], components: player.getCurrent() ? buildPlayerControlRows(player) : []});
        break;
      }

      case 'shuffle': {
        if (player.queueSize() === 0) {
          throw new Error('queue is empty');
        }

        player.shuffle();
        await interaction.reply({content: 'Shuffled upcoming tracks.', embeds: player.getCurrent() ? [buildQueueEmbed(player, 1, (await getGuildSettings(interaction.guild!.id)).defaultQueuePageSize)] : []});
        break;
      }

      case 'clear': {
        player.clear();
        await interaction.reply('Cleared upcoming tracks.');
        break;
      }

      case 'remove': {
        player.removeFromQueue(interaction.options.getInteger('position')!, interaction.options.getInteger('amount') ?? 1);
        await interaction.reply('Removed from the queue.');
        break;
      }

      case 'repeat': {
        await this.setRepeatMode(interaction.options.getString('mode', true), interaction.guild!.id);
        await interaction.reply({content: `Repeat mode set to **${interaction.options.getString('mode', true)}**.`, components: player.getCurrent() ? buildPlayerControlRows(player) : []});
        break;
      }

      case 'volume': {
        if (!player.getCurrent()) {
          throw new Error('nothing is playing');
        }

        const level = interaction.options.getInteger('level')!;
        player.setVolume(level);
        await interaction.reply(`Volume set to ${level}%.`);
        break;
      }

      default:
        throw new Error('unknown music action');
    }
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) {
      return;
    }

    const player = this.playerManager.get(interaction.guild.id);

    switch (interaction.customId) {
      case MUSIC_BUTTON_IDS.replay: {
        if (!player.getCurrent()) {
          throw new Error('nothing is currently playing');
        }

        await player.seek(0);
        await interaction.update({content: 'Restarted.', embeds: [buildPlayingMessageEmbed(player)], components: buildPlayerControlRows(player)});
        break;
      }

      case MUSIC_BUTTON_IDS.pauseResume: {
        if (player.status === STATUS.PLAYING) {
          player.pause();
          await interaction.update({content: 'Paused.', embeds: [buildPlayingMessageEmbed(player)], components: buildPlayerControlRows(player)});
          break;
        }

        if (!player.getCurrent()) {
          throw new Error('nothing to play');
        }

        if (!player.voiceConnection) {
          const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild);
          await player.connect(targetVoiceChannel);
        }

        await player.play();
        await interaction.update({content: 'Resumed.', embeds: [buildPlayingMessageEmbed(player)], components: buildPlayerControlRows(player)});
        break;
      }

      case MUSIC_BUTTON_IDS.skip: {
        await player.forward(1);
        await interaction.update({content: 'Skipped.', embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [], components: player.getCurrent() ? buildPlayerControlRows(player) : []});
        break;
      }

      case MUSIC_BUTTON_IDS.stop: {
        player.stop();
        await interaction.update({content: 'Stopped and cleared the queue.', embeds: [], components: []});
        break;
      }

      case MUSIC_BUTTON_IDS.loopSong: {
        await this.setRepeatMode(player.loopCurrentSong ? 'off' : 'song', interaction.guild.id);
        await interaction.update({embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [], components: player.getCurrent() ? buildPlayerControlRows(player) : []});
        break;
      }

      case MUSIC_BUTTON_IDS.loopQueue: {
        await this.setRepeatMode(player.loopCurrentQueue ? 'off' : 'queue', interaction.guild.id);
        await interaction.update({embeds: player.getCurrent() ? [buildPlayingMessageEmbed(player)] : [], components: player.getCurrent() ? buildPlayerControlRows(player) : []});
        break;
      }

      case MUSIC_BUTTON_IDS.shuffle: {
        if (player.queueSize() === 0) {
          throw new Error('queue is empty');
        }

        player.shuffle();
        await interaction.reply({content: 'Shuffled upcoming tracks.', ephemeral: true});
        break;
      }

      case MUSIC_BUTTON_IDS.queue: {
        const pageSize = (await getGuildSettings(interaction.guild.id)).defaultQueuePageSize;
        await interaction.reply({embeds: [buildQueueEmbed(player, 1, pageSize)], ephemeral: true});
        break;
      }

      default:
        throw new Error('unknown player control');
    }
  }

  public async handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    const query = interaction.options.getString('query')?.trim();

    if (!query) {
      await interaction.respond([]);
      return;
    }

    try {
      // eslint-disable-next-line no-new
      new URL(query);
      await interaction.respond([]);
      return;
    } catch {}

    let suggestions;
    try {
      suggestions = await this.cache.wrap(getYouTubeAndSpotifySuggestionsFor, query, this.spotify, 10, {
        expiresIn: ONE_HOUR_IN_SECONDS,
        key: `music-autocomplete:${query}`,
      });
    } catch (error: unknown) {
      if (error instanceof SpotifySuggestionsUnavailableError) {
        suggestions = error.suggestions;
      } else {
        throw error;
      }
    }

    await interaction.respond(suggestions);
  }

  private async setRepeatMode(mode: string, guildId: string): Promise<void> {
    const player = this.playerManager.get(guildId);

    if (!player.getCurrent()) {
      throw new Error('nothing is currently playing');
    }

    player.loopCurrentSong = mode === 'song';
    player.loopCurrentQueue = mode === 'queue';
  }
}
