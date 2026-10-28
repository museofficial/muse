import {AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {URL} from 'url';
import {SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder} from '@discordjs/builders';
import {inject, injectable, optional} from 'inversify';
import Spotify from 'spotify-web-api-node';
import Command from './index.js';
import {TYPES} from '../types.js';
import ThirdParty from '../services/third-party.js';
import getYouTubeAndSpotifySuggestionsFor, {SpotifySuggestionsUnavailableError} from '../utils/get-youtube-and-spotify-suggestions-for.js';
import KeyValueCacheProvider from '../services/key-value-cache.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {truncate} from '../utils/string.js';
import {localizeCommand} from '../i18n/commands.js';

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

    this.slashCommand = localizeCommand(new SlashCommandBuilder()
      .setName('play')
      .addStringOption(option => option
        .setName('query')
        .setAutocomplete(true)
        .setRequired(true))
      .addBooleanOption(option => option
        .setName('immediate'))
      .addBooleanOption(option => option
        .setName('shuffle'))
      .addBooleanOption(option => option
        .setName('split'))
      .addBooleanOption(option => option
        .setName('skip')), thirdParty === undefined ? {} : {'play.query': 'command.play.queryWithSpotify'});
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

    let queryProtocol: string | undefined;
    try {
      queryProtocol = new URL(query).protocol;
    } catch {}

    // Don't return suggestions for supported provider URLs
    if (queryProtocol && ['http:', 'https:', 'spotify:'].includes(queryProtocol)) {
      await interaction.respond([]);
      return;
    }

    let suggestions;

    try {
      suggestions = await this.cache.wrap(
        getYouTubeAndSpotifySuggestionsFor,
        query,
        this.spotify,
        10,
        {
          expiresIn: ONE_HOUR_IN_SECONDS,
          key: `autocomplete:${query}`,
        });
    } catch (error: unknown) {
      if (error instanceof SpotifySuggestionsUnavailableError) {
        suggestions = error.suggestions;
      } else {
        throw error;
      }
    }

    // Normalize after reading the cache or fallback so old results obey Discord's limits too.
    const choices = suggestions
      .filter(({name, value}) => name.length > 0 && (typeof value !== 'string' || value.length <= 100))
      .slice(0, 25)
      .map(choice => ({...choice, name: truncate(choice.name, 100)}));

    await interaction.respond(choices);
  }
}
