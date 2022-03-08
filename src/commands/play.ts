import {AutocompleteInteraction, CommandInteraction, GuildMember} from 'discord.js';
import {URL} from 'url';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Spotify from 'spotify-web-api-node';
import Command from '.';
import {TYPES} from '../types.js';
import ThirdParty from '../services/third-party.js';
import getYouTubeAndSpotifySuggestionsFor from '../utils/get-youtube-and-spotify-suggestions-for.js';
import KeyValueCacheProvider from '../services/key-value-cache.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('play')
    .setDescription('play a song or resume playback')
    .addStringOption(option => option
      .setName('query')
      .setDescription('YouTube URL, Spotify URL, or search query')
      .setAutocomplete(true))
    .addBooleanOption(option => option
      .setName('immediate')
      .setDescription('add track to the front of the queue'))
    .addBooleanOption(option => option
      .setName('shuffle')
      .setDescription('shuffle the input if you\'re adding multiple tracks'))
    .addBooleanOption(option => option
      .setName('split')
      .setDescription('if a track has chapters, split it'));

  public requiresVC = true;

  private readonly spotify: Spotify;
  private readonly cache: KeyValueCacheProvider;
  private readonly addQueryToQueue: AddQueryToQueue;
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.ThirdParty) thirdParty: ThirdParty, @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider, @inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue, @inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.spotify = thirdParty.spotify;
    this.cache = cache;
    this.addQueryToQueue = addQueryToQueue;
    this.playerManager = playerManager;
  }

  // eslint-disable-next-line complexity
  public async execute(interaction: CommandInteraction): Promise<void> {
    const query = interaction.options.getString('query');

    const player = this.playerManager.get(interaction.guild!.id);
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    if (!query) {
      if (player.status === STATUS.PLAYING) {
        throw new Error('already playing, give me a song name');
      }

      // Must be resuming play
      if (!player.getCurrent()) {
        throw new Error('nothing to play');
      }

      await player.connect(targetVoiceChannel);
      await player.play();

      await interaction.reply({
        content: 'the stop-and-go light is now green',
        embeds: [buildPlayingMessageEmbed(player)],
      });

      return;
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: query.trim(),
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
    });
  }

  public async handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    const query = interaction.options.getString('query')?.trim();

    if (!query || query.length === 0) {
      await interaction.respond([]);
      return;
    }

    try {
      // Don't return suggestions for URLs
      // eslint-disable-next-line no-new
      new URL(query);
      await interaction.respond([]);
      return;
    } catch {}

    const suggestions = await this.cache.wrap(
      getYouTubeAndSpotifySuggestionsFor,
      query,
      this.spotify,
      10,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
        key: `autocomplete:${query}`,
      });

    await interaction.respond(suggestions);
  }
}
