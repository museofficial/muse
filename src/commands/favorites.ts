import {SlashCommandBuilder} from '@discordjs/builders';
import {AutocompleteInteraction, CommandInteraction, MessageEmbed} from 'discord.js';
import {inject, injectable} from 'inversify';
import Command from '.';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {TYPES} from '../types.js';
import {prisma} from '../utils/db.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('Fügt den Song zu den Favoriten hinzu.')
    .addSubcommand(subcommand => subcommand
      .setName('use')
      .setDescription('Nutze einen Favoriten')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Name des Favoriten')
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('immediate')
        .setDescription('Fügt den Song ganz an die Spitze'))
      .addBooleanOption(option => option
        .setName('shuffle')
        .setDescription('Lass mich entscheiden was zuerst kommt, wenn du mehrere Songs hinzufügst'))
      .addBooleanOption(option => option
        .setName('split')
        .setDescription('Splittet den Song wenn er mehrere Kapitel hat')))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('Liste alle Favoriten auf'))
    .addSubcommand(subcommand => subcommand
      .setName('create')
      .setDescription('Erstelle einen neuen Favoriten')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Gib diesen Namen ein wenn du einen Favoriten nutzen willst')
        .setRequired(true))
      .addStringOption(option => option
        .setName('query')
        .setDescription('Irgendeinen Befehl den du dem Play Befehl geben würdest')
        .setRequired(true),
      ))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('Löscht einen Favoriten')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Name des Favoriten')
        .setAutocomplete(true)
        .setRequired(true),
      ),
    );

  constructor(@inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue) {}

  requiresVC = (interaction: CommandInteraction) => interaction.options.getSubcommand() === 'use';

  async execute(interaction: CommandInteraction) {
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
        throw new Error('Unbekannter Befehl!');
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

  private async use(interaction: CommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({
      where: {
        name,
        guildId: interaction.guild!.id,
      },
    });

    if (!favorite) {
      throw new Error('Es gibt keinen Favoriten mit dem Namen!');
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: favorite.query,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
    });
  }

  private async list(interaction: CommandInteraction) {
    const favorites = await prisma.favoriteQuery.findMany({
      where: {
        guildId: interaction.guild!.id,
      },
    });

    if (favorites.length === 0) {
      await interaction.reply('Es gibt keine Favoriten!');
      return;
    }

    const embed = new MessageEmbed().setTitle('Favoriten');

    let description = '';
    for (const favorite of favorites) {
      description += `**${favorite.name}**: ${favorite.query} (<@${favorite.authorId}>)\n`;
    }

    embed.setDescription(description);

    await interaction.reply({
      embeds: [embed],
    });
  }

  private async create(interaction: CommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    const query = interaction.options.getString('query')!.trim();

    const existingFavorite = await prisma.favoriteQuery.findFirst({where: {
      guildId: interaction.guild!.id,
      name,
    }});

    if (existingFavorite) {
      throw new Error('Es existiert bereits ein Favorit mit diesem Namen!');
    }

    await prisma.favoriteQuery.create({
      data: {
        authorId: interaction.member!.user.id,
        guildId: interaction.guild!.id,
        name,
        query,
      },
    });

    await interaction.reply('👍 Favorit erstellt!');
  }

  private async remove(interaction: CommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({where: {
      name,
      guildId: interaction.guild!.id,
    }});

    if (!favorite) {
      throw new Error('Es existiert kein Favorit mit diesem Namen!');
    }

    const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

    if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
      throw new Error('Du kannst nur deine eigenen Favoriten entfernen!');
    }

    await prisma.favoriteQuery.delete({where: {id: favorite.id}});

    await interaction.reply('👍 Favorit gelöscht!');
  }
}
