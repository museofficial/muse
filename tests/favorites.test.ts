import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {SlashCommandStringOption} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import type {APIEmbed} from 'discord.js';
import type {Pagination} from 'pagination.djs';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../src/utils/db.js', () => ({prisma: {favoriteQuery: db}}));

import Favorites from '../src/commands/favorites.js';

const authorId = '123456789012345678';
const ownerId = '987654321098765432';
const makeFavorite = (name = 'favorite', query = 'song', author = authorId) => ({
  id: 1,
  name,
  query,
  authorId: author,
  guildId: 'guild',
});

const makeInteraction = (subcommand: string, strings: Record<string, string> = {}, userId = authorId) => {
  const message = {createMessageComponentCollector: vi.fn(() => ({on: vi.fn()}))};
  const reply = vi.fn().mockResolvedValue(message);
  const respond = vi.fn().mockResolvedValue(undefined);
  const interaction = Object.setPrototypeOf({
    id: 'interaction',
    user: {id: userId},
    member: {user: {id: userId}},
    guild: {id: 'guild', ownerId},
    options: {
      getSubcommand: () => subcommand,
      getString: (key: string) => strings[key] ?? null,
      getBoolean: () => null,
    },
    reply,
    respond,
    fetchReply: vi.fn().mockResolvedValue(message),
  }, ChatInputCommandInteraction.prototype) as ChatInputCommandInteraction;

  return {interaction, reply, respond};
};

const expectValidEmbed = (embed: APIEmbed) => {
  // Exercise the real Discord field validators as well as the aggregate API limit.
  expect(() => new EmbedBuilder().setFields(embed.fields ?? []).toJSON()).not.toThrow();
  expect(embed.fields!.length).toBeLessThanOrEqual(25);
  const fieldLength = embed.fields!.reduce((total, field) => total + field.name.length + field.value.length, 0);
  const totalLength = fieldLength + (embed.title?.length ?? 0) + (embed.description?.length ?? 0)
    + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0);
  expect(totalLength).toBeLessThanOrEqual(6000);
};

beforeEach(() => {
  vi.resetAllMocks();
  db.findFirst.mockResolvedValue(null);
  db.findMany.mockResolvedValue([]);
});

describe('favorite creation', () => {
  it('publishes create bounds without limiting legacy use and remove names', () => {
    const options = new Favorites({} as never).slashCommand.toJSON().options as Array<{
      name: string;
      options?: Array<{name: string; min_length?: number; max_length?: number}>;
    }>;
    const getOption = (subcommand: string, name: string) => options.find(option => option.name === subcommand)!
      .options!.find(option => option.name === name)!;

    expect(getOption('create', 'name')).toMatchObject({min_length: 1, max_length: 100});
    expect(getOption('create', 'query')).toMatchObject({min_length: 1});
    expect(getOption('use', 'name').max_length).toBeUndefined();
    expect(getOption('remove', 'name').max_length).toBeUndefined();
  });

  it.each(['', ' \t\n ', 'n'.repeat(101)])('rejects invalid new names before accessing the database: %j', async name => {
    const {interaction, reply} = makeInteraction('create', {name, query: 'song'});

    await expect(new Favorites({} as never).execute(interaction)).rejects.toThrow('favorite name must be between 1 and 100 characters');

    expect(db.findFirst).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it.each(['', ' \t\n '])('rejects empty queries before accessing the database: %j', async query => {
    const {interaction} = makeInteraction('create', {name: 'favorite', query});

    await expect(new Favorites({} as never).execute(interaction)).rejects.toThrow('favorite query must not be empty');

    expect(db.findFirst).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });

  it('accepts a trimmed 100-character name and stores the entire trimmed query', async () => {
    const name = 'n'.repeat(100);
    const query = `https://example.com/playlist?items=${'q'.repeat(4000)}`;
    const {interaction, reply} = makeInteraction('create', {name: ` ${name} `, query: ` ${query} `});

    await new Favorites({} as never).execute(interaction);

    expect(db.create).toHaveBeenCalledWith({data: {name, query, authorId, guildId: 'guild'}});
    expect(reply).toHaveBeenCalledWith('👍 favorite created');
  });

  it('preserves the duplicate-name rejection', async () => {
    db.findFirst.mockResolvedValue(makeFavorite());
    const {interaction} = makeInteraction('create', {name: 'favorite', query: 'new song'});

    await expect(new Favorites({} as never).execute(interaction)).rejects.toThrow('a favorite with that name already exists');
    expect(db.create).not.toHaveBeenCalled();
  });
});

describe('favorite autocomplete', () => {
  it('omits unrepresentable legacy names before applying the 25-choice limit', async () => {
    const validNames = ['n'.repeat(100), ...Array.from({length: 25}, (_, i) => `favorite ${i}`)];
    db.findMany.mockResolvedValue(['', 'n'.repeat(101), ...validNames].map(name => makeFavorite(name)));
    const {interaction, respond} = makeInteraction('use', {name: ''});

    await new Favorites({} as never).handleAutocompleteInteraction(interaction as never);

    const choices = respond.mock.calls[0][0] as Array<{name: string; value: string}>;
    expect(choices).toEqual(validNames.slice(0, 25).map(name => ({name, value: name})));
    expect(() => new SlashCommandStringOption().setName('favorite').setDescription('favorite').addChoices(...choices).toJSON()).not.toThrow();
  });

  it('preserves exact names and case-insensitive prefix filtering', async () => {
    db.findMany.mockResolvedValue(['My Mix', 'my other mix', 'unrelated'].map(name => makeFavorite(name)));
    const {interaction, respond} = makeInteraction('use', {name: ' MY '});

    await new Favorites({} as never).handleAutocompleteInteraction(interaction as never);

    expect(respond).toHaveBeenCalledWith([
      {name: 'My Mix', value: 'My Mix'},
      {name: 'my other mix', value: 'my other mix'},
    ]);
  });

  it('still restricts remove choices to their author or the guild owner', async () => {
    db.findMany.mockResolvedValue([makeFavorite('mine'), makeFavorite('theirs', 'song', 'another-user')]);
    const command = new Favorites({} as never);
    const member = makeInteraction('remove', {name: ''});
    const owner = makeInteraction('remove', {name: ''}, ownerId);

    await command.handleAutocompleteInteraction(member.interaction as never);
    await command.handleAutocompleteInteraction(owner.interaction as never);

    expect(member.respond).toHaveBeenCalledWith([{name: 'mine', value: 'mine'}]);
    expect(owner.respond).toHaveBeenCalledWith([{name: 'mine', value: 'mine'}, {name: 'theirs', value: 'theirs'}]);
  });
});

describe('favorite lists and legacy names', () => {
  it('retains 25 favorites per page for ordinary short entries', async () => {
    db.findMany.mockResolvedValue(Array.from({length: 26}, (_, i) => makeFavorite(`favorite ${i}`)));
    const {interaction, reply} = makeInteraction('list');

    await new Favorites({} as never).execute(interaction);

    const pagination = reply.mock.calls[0][0].embeds[0] as Pagination;
    expect(pagination.totalPages).toBe(2);
    expect(pagination.toJSON().fields).toHaveLength(25);
    expectValidEmbed(pagination.toJSON());
    const lastPage = pagination.goToPage(2).toJSON();
    expect(lastPage.fields).toEqual([{name: 'favorite 25', value: `song (<@${authorId}>)`, inline: false}]);
    expectValidEmbed(lastPage);
  });

  it('keeps every page within individual and total embed limits for oversized legacy entries', async () => {
    const favorites = Array.from({length: 9}, (_, i) => makeFavorite(`${i}-${'n'.repeat(300)}`, 'q'.repeat(4000)));
    db.findMany.mockResolvedValue(favorites);
    const {interaction, reply} = makeInteraction('list');

    await new Favorites({} as never).execute(interaction);

    const pagination = reply.mock.calls[0][0].embeds[0] as Pagination;
    const displayedNames: string[] = [];
    for (let page = 1; page <= pagination.totalPages; page++) {
      const embed = pagination.goToPage(page).toJSON();
      expectValidEmbed(embed);
      for (const field of embed.fields!) {
        expect(field.name).toHaveLength(256);
        expect(field.value).toHaveLength(1024);
        expect(field.value).toMatch(new RegExp(` \\(<@${authorId}>\\)$`));
        displayedNames.push(field.name);
      }
    }

    expect(displayedNames.map(name => name[0])).toEqual(favorites.map(favorite => favorite.name[0]));
    expect(favorites.every(favorite => favorite.query.length === 4000 && favorite.name.length === 302)).toBe(true);
    expect(db.create).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('renders a placeholder for an empty legacy name', async () => {
    db.findMany.mockResolvedValue([makeFavorite('', '')]);
    const {interaction, reply} = makeInteraction('list');

    await new Favorites({} as never).execute(interaction);

    const embed = (reply.mock.calls[0][0].embeds[0] as Pagination).toJSON();
    expectValidEmbed(embed);
    expect(embed.fields![0].name).toBe('(unnamed favorite)');
  });

  it('plays and removes a legacy long name using its exact identity and full saved query', async () => {
    const favorite = makeFavorite('n'.repeat(300), 'q'.repeat(5000));
    db.findMany.mockResolvedValue([favorite]);
    db.findFirst.mockResolvedValue(favorite);
    const addToQueue = vi.fn().mockResolvedValue(undefined);
    const command = new Favorites({addToQueue} as never);
    const list = makeInteraction('list');
    await command.execute(list.interaction);
    const use = makeInteraction('use', {name: favorite.name});
    await command.execute(use.interaction);
    const remove = makeInteraction('remove', {name: favorite.name});
    await command.execute(remove.interaction);

    expect(db.findFirst).toHaveBeenNthCalledWith(1, {where: {name: favorite.name, guildId: 'guild'}});
    expect(db.findFirst).toHaveBeenNthCalledWith(2, {where: {name: favorite.name, guildId: 'guild'}});
    expect(addToQueue).toHaveBeenCalledWith({
      interaction: use.interaction,
      query: favorite.query,
      shuffleAdditions: false,
      addToFrontOfQueue: false,
      shouldSplitChapters: false,
      skipCurrentTrack: false,
    });
    expect(db.delete).toHaveBeenCalledWith({where: {id: favorite.id}});
    expect(remove.reply).toHaveBeenCalledWith('👍 favorite removed');
  });
});
