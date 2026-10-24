import {SlashCommandBuilder} from '@discordjs/builders';
import {APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {TYPES} from '../types.js';
import {prisma} from '../utils/db.js';
import {Pagination} from 'pagination.djs';
import {truncate} from '../utils/string.js';

const MAX_NAME_LENGTH = 100;

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('save and reuse named searches or URLs for this server')
    .addSubcommand(subcommand => subcommand
      .setName('use')
      .setDescription('play a saved search or URL')
      .addStringOption(option => option
        .setName('name')
        .setDescription('name of favorite')
        .setRequired(true)
        .setAutocomplete(true))
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
        .setDescription('skip the currently playing track')))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('list all favorites'))
    .addSubcommand(subcommand => subcommand
      .setName('create')
      .setDescription('save a named search or URL for this server')
      .addStringOption(option => option
        .setName('name')
        .setDescription('you\'ll type this when using this favorite')
        .setMinLength(1)
        .setMaxLength(MAX_NAME_LENGTH)
        .setRequired(true))
      .addStringOption(option => option
        .setName('query')
        .setDescription('any input you\'d normally give to the play command')
        .setMinLength(1)
        .setRequired(true),
      ))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('remove a favorite')
      .addStringOption(option => option
        .setName('name')
        .setDescription('name of favorite')
        .setAutocomplete(true)
        .setRequired(true),
      ),
    );

  constructor(@inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue) {
  }

  requiresVC = (interaction: ChatInputCommandInteraction) => interaction.options.getSubcommand() === 'use';

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'use':
        await this.use(interaction);
        break;
      case 'list':
        await this.list(interaction);
        break;
      case 'create':
        await this.create(interaction);
        break;
      case 'remove':
        await this.remove(interaction);
        break;
      default:
        throw new Error('unknown subcommand');
    }
  }

  async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const query = interaction.options.getString('name')!.trim();

    const favorites = await prisma.favoriteQuery.findMany({
      where: {
        guildId: interaction.guild!.id,
      },
    });

    // Legacy names outside the choice limits can still be typed in full.
    let results = favorites.filter(f => f.name.length > 0 && f.name.length <= MAX_NAME_LENGTH
      && f.name.toLowerCase().startsWith(query.toLowerCase()));

    if (subcommand === 'remove') {
      // Only show favorites that user is allowed to remove
      results = interaction.member?.user.id === interaction.guild?.ownerId ? results : results.filter(r => r.authorId === interaction.member!.user.id);
    }

    // Limit results to 25 maximum per Discord limits
    const trimmed = results.length > 25 ? results.slice(0, 25) : results;
    await interaction.respond(trimmed.map(r => ({
      name: r.name,
      value: r.name,
    })));
  }

  private async use(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({
      where: {
        name,
        guildId: interaction.guild!.id,
      },
    });

    if (!favorite) {
      throw new Error('no favorite with that name exists');
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: favorite.query,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const favorites = await prisma.favoriteQuery.findMany({
      where: {
        guildId: interaction.guild!.id,
      },
    });

    if (favorites.length === 0) {
      await interaction.reply('there aren\'t any favorites yet');
      return;
    }

    const fields = new Array<APIEmbedField>(favorites.length);
    for (let index = 0; index < favorites.length; index++) {
      const favorite = favorites[index];
      const attribution = ` (<@${favorite.authorId}>)`;
      fields[index] = {
        inline: false,
        name: truncate(favorite.name || '(unnamed favorite)', 256),
        value: `${truncate(favorite.query, 1024 - attribution.length)}${attribution}`,
      };
    }

    // Reserve enough room for the paginator's footer even on the last page.
    const footerLength = `Pages: ${favorites.length}/${favorites.length}`.length;
    const largestField = fields.reduce((largest, field) => Math.max(largest, field.name.length + field.value.length), 0);
    const pageSize = Math.min(25, Math.floor((6000 - footerLength) / largestField));

    await new Pagination(
      interaction as ChatInputCommandInteraction<'cached'>,
      {ephemeral: true, limit: pageSize})
      .setFields(fields)
      .paginateFields(true)
      .render();
  }

  private async create(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    const query = interaction.options.getString('query')!.trim();

    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new Error(`favorite name must be between 1 and ${MAX_NAME_LENGTH} characters`);
    }

    if (query.length === 0) {
      throw new Error('favorite query must not be empty');
    }

    const existingFavorite = await prisma.favoriteQuery.findFirst({where: {
      guildId: interaction.guild!.id,
      name,
    }});

    if (existingFavorite) {
      throw new Error('a favorite with that name already exists');
    }

    await prisma.favoriteQuery.create({
      data: {
        authorId: interaction.member!.user.id,
        guildId: interaction.guild!.id,
        name,
        query,
      },
    });

    await interaction.reply('👍 favorite created');
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({where: {
      name,
      guildId: interaction.guild!.id,
    }});

    if (!favorite) {
      throw new Error('no favorite with that name exists');
    }

    const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

    if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
      throw new Error('you can only remove your own favorites');
    }

    await prisma.favoriteQuery.delete({where: {id: favorite.id}});

    await interaction.reply('👍 favorite removed');
  }
}
