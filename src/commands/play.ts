import { SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from '@discordjs/builders';
import { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { inject, injectable, optional } from 'inversify';
import Spotify from 'spotify-web-api-node';
import { URL } from 'url';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import KeyValueCacheProvider from '../services/key-value-cache.js';
import ThirdParty from '../services/third-party.js';
import { TYPES } from '../types.js';
import { ONE_HOUR_IN_SECONDS } from '../utils/constants.js';
import getYouTubeAndSpotifySuggestionsFor from '../utils/get-youtube-and-spotify-suggestions-for.js';
import Command from './index.js';

@injectable()
export default class implements Command {
  public readonly slashCommand: Partial<SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder> & Pick<SlashCommandBuilder, 'toJSON'>;

  public requiresVC = true;

  private readonly spotify?: Spotify;
  private readonly cache: KeyValueCacheProvider;
  private readonly addQueryToQueue: AddQueryToQueue;

  constructor(@inject(TYPES.ThirdParty) @optional() thirdParty: ThirdParty, @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider, @inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue) {
    this.spotify = thirdParty?.spotify;
    this.cache = cache;
    this.addQueryToQueue = addQueryToQueue;

    const queryDescription = thirdParty === undefined
      ? 'YouTube URL or search query'
      : 'YouTube URL, Spotify URL, or search query';

    this.slashCommand = new SlashCommandBuilder()
      .setName('play')
      .setDescription('play a song')
      .addStringOption(option => option
        .setName('query')
        .setDescription(queryDescription)
        .setAutocomplete(true)
        .setRequired(true))
      .addBooleanOption(option => option
        .setName('immediate')
        .setDescription('add track to the front of the queue'))
      .addBooleanOption(option => option
        .setName('shuffle')
        .setDescription('shuffle the input if you\'re adding multiple tracks'))
      .addBooleanOption(option => option
        .setName('split')
        .setDescription('if a track has chapters, split it'))
      .addBooleanOption(option => option
        .setName('skip')
        .setDescription('skip the currently playing track'));
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query')!;

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: query.trim(),
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
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
       
      new URL(query);
      await interaction.respond([]);
      return;
    } catch {
      // Ignore
    }

    const suggestions = await this.cache.wrap(
      async (...args: unknown[]) => getYouTubeAndSpotifySuggestionsFor(args[0] as string, args[1] as Spotify, args[2] as number),
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
