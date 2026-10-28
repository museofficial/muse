import {SlashCommandBuilder} from '@discordjs/builders';
import {APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {TYPES} from '../types.js';
import {prisma} from '../utils/db.js';
import {Pagination} from 'pagination.djs';
import {truncate} from '../utils/string.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

const MAX_NAME_LENGTH = 100;

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('favorites')
    .addSubcommand(subcommand => subcommand
      .setName('use')
      .addStringOption(option => option
        .setName('name')
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('immediate'))
      .addBooleanOption(option => option
        .setName('shuffle'))
      .addBooleanOption(option => option
        .setName('split'))
      .addBooleanOption(option => option
        .setName('skip')))
    .addSubcommand(subcommand => subcommand
      .setName('list'))
    .addSubcommand(subcommand => subcommand
      .setName('create')
      .addStringOption(option => option
        .setName('name')
        .setMinLength(1)
        .setMaxLength(MAX_NAME_LENGTH)
        .setRequired(true))
      .addStringOption(option => option
        .setName('query')
        .setMinLength(1)
        .setRequired(true),
      ))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .addStringOption(option => option
        .setName('name')
        .setAutocomplete(true)
        .setRequired(true),
      ),
    ));

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
        throw new LocalizedError('error.unknownSubcommand');
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
      throw new LocalizedError('favorites.error.notFound');
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
      await interaction.reply(t(interaction.locale, 'favorites.empty'));
      return;
    }

    const fields = new Array<APIEmbedField>(favorites.length);
    for (let index = 0; index < favorites.length; index++) {
      const favorite = favorites[index];
      const attribution = ` (<@${favorite.authorId}>)`;
      fields[index] = {
        inline: false,
        name: truncate(favorite.name || t(interaction.locale, 'favorites.unnamed'), 256),
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
      throw new LocalizedError('favorites.error.nameLength', {max: MAX_NAME_LENGTH});
    }

    if (query.length === 0) {
      throw new LocalizedError('favorites.error.emptyQuery');
    }

    const existingFavorite = await prisma.favoriteQuery.findFirst({where: {
      guildId: interaction.guild!.id,
      name,
    }});

    if (existingFavorite) {
      throw new LocalizedError('favorites.error.duplicate');
    }

    await prisma.favoriteQuery.create({
      data: {
        authorId: interaction.member!.user.id,
        guildId: interaction.guild!.id,
        name,
        query,
      },
    });

    await interaction.reply(t(interaction.locale, 'favorites.created'));
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({where: {
      name,
      guildId: interaction.guild!.id,
    }});

    if (!favorite) {
      throw new LocalizedError('favorites.error.notFound');
    }

    const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

    if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
      throw new LocalizedError('favorites.error.notOwner');
    }

    await prisma.favoriteQuery.delete({where: {id: favorite.id}});

    await interaction.reply(t(interaction.locale, 'favorites.removed'));
  }
}
