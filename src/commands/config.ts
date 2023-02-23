import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import Command from './index.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot-Einstellungen bearbeiten')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(subcommand => subcommand
      .setName('set-playlist-limit')
      .setDescription('die maximale Anzahl der Songs festlegen die aus einer Wiedergabeliste hinzugefügt werden können')
      .addIntegerOption(option => option
        .setName('limit')
        .setDescription('maximale Anzahl von Songs')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-wait-after-queue-empties')
      .setDescription('die Wartezeit einstellen, bevor der Sprachkanal bei leerer Warteschlange verlassen wird')
      .addIntegerOption(option => option
        .setName('delay')
        .setDescription('Verzögerung in Sekunden. Auf 0 setzen, um diese Funktion zu deaktivieren')
        .setRequired(true)
        .setMinValue(0)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-if-no-listeners')
      .setDescription('festlegen ob der Bot gehen soll, wenn alle anderen Benutzer gehen')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('ob der Bot einen leeren Kanal verlassen soll')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('get')
      .setDescription('alle Einstellungen anzeigen'));

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit: number = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new Error('ungültiges Limit');
        }

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            playlistLimit: limit,
          },
        });

        await interaction.reply('👍 Limit aktualisiert');

        break;
      }

      case 'set-wait-after-queue-empties': {
        const delay = interaction.options.getInteger('delay')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            secondsToWaitAfterQueueEmpties: delay,
          },
        });

        await interaction.reply('👍 Wartezeit aktualisiert');

        break;
      }

      case 'set-leave-if-no-listeners': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            leaveIfNoListeners: value,
          },
        });

        await interaction.reply('👍 Einstellungen aktualisiert');

        break;
      }

      case 'get': {
        const embed = new EmbedBuilder().setTitle('Config');

        const config = await prisma.setting.findUnique({where: {guildId: interaction.guild!.id}});

        if (!config) {
          throw new Error('keine Konfiguration gefunden');
        }

        const settingsToShow = {
          'Playlist Limit': config.playlistLimit,
          'Wartezeit bis der Bot bei leerer Warteschlange die Verbindung trennt.': config.secondsToWaitAfterQueueEmpties === 0
            ? 'nie verlassen'
            : `${config.secondsToWaitAfterQueueEmpties}s`,
          'Verlassen falls es keine Zuhörer mehr gibt': config.leaveIfNoListeners ? 'ja' : 'nein',
        };

        let description = '';
        for (const [key, value] of Object.entries(settingsToShow)) {
          description += `**${key}**: ${value}\n`;
        }

        embed.setDescription(description);

        await interaction.reply({embeds: [embed]});

        break;
      }

      default:
        throw new Error('unknown subcommand');
    }
  }
}
