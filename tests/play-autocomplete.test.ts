import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {SlashCommandStringOption} from '@discordjs/builders';

const mocks = vi.hoisted(() => ({youtube: vi.fn()}));
vi.mock('../src/utils/get-youtube-suggestions-for.js', () => ({default: mocks.youtube}));

import Play from '../src/commands/play.js';
import {SpotifySuggestionsUnavailableError} from '../src/utils/get-youtube-and-spotify-suggestions-for.js';

const makeInteraction = () => ({options: {getString: () => 'search'}, respond: vi.fn()});
const liveCache = {wrap: (fetch: (...args: unknown[]) => unknown, ...args: unknown[]) => fetch(...args)};
const expectValidChoices = (choices: Array<{name: string; value: string}>) => {
  expect(choices.length).toBeLessThanOrEqual(25);
  expect(() => new SlashCommandStringOption().setName('query').setDescription('query').addChoices(...choices).toJSON()).not.toThrow();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.youtube.mockResolvedValue([]);
});

describe('/play autocomplete output limits', () => {
  it('bounds provider labels without changing valid query values or Spotify URIs', async () => {
    const query = 'q'.repeat(100);
    mocks.youtube.mockResolvedValue([query, 'ordinary query']);
    const spotify = {search: vi.fn().mockResolvedValue({body: {
      albums: {items: [{id: 'album-id', name: 'a'.repeat(100), artists: [{name: 'Artist'}]}]},
      tracks: {items: [{id: 'track-id', name: 't'.repeat(100), artists: [{name: 'Artist'}]}]},
    }})};
    const interaction = makeInteraction();

    await new Play({spotify} as never, liveCache as never, {} as never).handleAutocompleteInteraction(interaction as never);

    const choices = interaction.respond.mock.calls[0][0];
    expectValidChoices(choices);
    expect(choices.map((choice: {value: string}) => choice.value)).toEqual([
      query, 'ordinary query', 'spotify:album:album-id', 'spotify:track:track-id',
    ]);
    expect(choices[1]).toEqual({name: 'YouTube: ordinary query', value: 'ordinary query'});
  });

  it.each(['cache', 'spotify fallback'])('normalizes %s results at the response boundary', async source => {
    const suggestions = [
      {name: 'Too long', value: 'q'.repeat(101)},
      {name: 'Spotify: ' + 't'.repeat(150), value: 'spotify:track:unchanged'},
      {name: 'Exact boundary', value: 'q'.repeat(100)},
      {name: 'Ordinary', value: 'ordinary'},
    ];
    const original = structuredClone(suggestions);
    const cache = {wrap: source === 'cache'
      ? vi.fn().mockResolvedValue(suggestions)
      : vi.fn().mockRejectedValue(new SpotifySuggestionsUnavailableError(suggestions, new Error('Spotify unavailable')))};
    const interaction = makeInteraction();

    await new Play(undefined as never, cache as never, {} as never).handleAutocompleteInteraction(interaction as never);

    const choices = interaction.respond.mock.calls[0][0];
    expectValidChoices(choices);
    expect(choices.map((choice: {value: string}) => choice.value)).toEqual([
      'spotify:track:unchanged', 'q'.repeat(100), 'ordinary',
    ]);
    expect(suggestions).toEqual(original);
  });
});
