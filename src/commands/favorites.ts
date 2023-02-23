import {SlashCommandBuilder} from '@discordjs/builders';
import {AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {inject, injectable} from 'inversify';
import Command from '.';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {TYPES} from '../types.js';
import {prisma} from '../utils/db.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('einen Song zu den Favoriten hinzufügen')
    .addSubcommand(subcommand => subcommand
      .setName('use')
      .setDescription('einen Favoriten benutzen')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Name des Favoriten')
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('immediate')
        .setDescription('Song an den Anfang der Warteschlange setzen'))
      .addBooleanOption(option => option
        .setName('shuffle')
        .setDescription('die Eingabe mischen, wenn du mehrere Spuren hinzufügst'))
      .addBooleanOption(option => option
        .setName('split')
        .setDescription('Wenn ein Song in Kapitel unterteilt ist, aufteilen')))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('alle Favoriten auflisten'))
    .addSubcommand(subcommand => subcommand
      .setName('create')
      .setDescription('einen neuen Favoriten anlegen')
      .addStringOption(option => option
        .setName('name')
        .setDescription('diesen Text schreiben, wenn du diesen Favoriten benutzt')
        .setRequired(true))
      .addStringOption(option => option
        .setName('query')
        .setDescription('jeder Befehl den du normalerweise zum abspielen nutzt')
        .setRequired(true),
      ))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('einen Favoriten entfernen')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Name des Favoriten')
        .setAutocomplete(true)
        .setRequired(true),
      ),
    );

  constructor(@inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue) {}

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

    let results = query === '' ? favorites : favorites.filter(f => f.name.startsWith(query));

    if (subcommand === 'remove') {
      // Only show favorites that user is allowed to remove
      results = interaction.member?.user.id === interaction.guild?.ownerId ? results : results.filter(r => r.authorId === interaction.member!.user.id);
    }

    await interaction.respond(results.map(r => ({
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
      throw new Error('es gibt keinen Favoriten mit diesem Namen');
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: favorite.query,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
    });
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const favorites = await prisma.favoriteQuery.findMany({
      where: {
        guildId: interaction.guild!.id,
      },
    });

    if (favorites.length === 0) {
      await interaction.reply('es gibt noch keine Favoriten');
      return;
    }

    const embed = new EmbedBuilder().setTitle('Favoriten');

    let description = '';
    for (const favorite of favorites) {
      description += `**${favorite.name}**: ${favorite.query} (<@${favorite.authorId}>)\n`;
    }

    embed.setDescription(description);

    await interaction.reply({
      embeds: [embed],
    });
  }

  private async create(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    const query = interaction.options.getString('query')!.trim();

    const existingFavorite = await prisma.favoriteQuery.findFirst({where: {
      guildId: interaction.guild!.id,
      name,
    }});

    if (existingFavorite) {
      throw new Error('ein Favorit mit diesem Namen existiert bereits');
    }

    await prisma.favoriteQuery.create({
      data: {
        authorId: interaction.member!.user.id,
        guildId: interaction.guild!.id,
        name,
        query,
      },
    });

    await interaction.reply('👍 Favorit angelegt');
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({where: {
      name,
      guildId: interaction.guild!.id,
    }});

    if (!favorite) {
      throw new Error('es gibt keinen Favoriten mit diesem Namen');
    }

    const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

    if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
      throw new Error('Du kannst nur deine eigenen Favoriten entfernen');
    }

    await prisma.favoriteQuery.delete({where: {id: favorite.id}});

    await interaction.reply('👍 Favorit entfernt');
  }
}
