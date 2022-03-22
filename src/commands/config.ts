import {SlashCommandBuilder} from '@discordjs/builders';
import {CommandInteraction, MessageEmbed} from 'discord.js';
import {injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import updatePermissionsForGuild from '../utils/update-permissions-for-guild.js';
import Command from './index.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Hier kannst du die Bot Einstellungen anpassen.')
    .addSubcommand(subcommand => subcommand
      .setName('set-playlist-limit')
      .setDescription('Setzt die maximale Anzahl an Songs die von einer Playlist hinzugefügt werden können.')
      .addIntegerOption(option => option
        .setName('limit')
        .setDescription('Maximale Anzahl an Songs')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-role')
      .setDescription('Setzt die Rolle, welcher es erlaubt ist den Bot zu bedienen.')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Erlaubte Rolle')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-wait-after-queue-empties')
      .setDescription('Setzt die Zeit die der Bot warten soll bis er den Channel verlässt, wenn die Queue leer ist.')
      .addIntegerOption(option => option
        .setName('delay')
        .setDescription('Zeit in Sekunden (auf 0 setzen wenn er drin bleiben soll)')
        .setRequired(true)
        .setMinValue(0)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-if-no-listeners')
      .setDescription('Setzt den Befehl das der Bot den Channel verlassen soll, wenn kein anderer User mehr da ist.')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('Soll er den Channel verlassen wenn alle weg sind?')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('get')
      .setDescription('Zeigt alle gesetzten Einstellungen.'));

  async execute(interaction: CommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new Error('0 ist keine Möglichkeit!');
        }

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            playlistLimit: limit,
          },
        });

        await interaction.reply('👍 Limit gesetzt.');

        break;
      }

      case 'set-role': {
        const role = interaction.options.getRole('role')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            roleId: role.id,
          },
        });

        await updatePermissionsForGuild(interaction.guild!);

        await interaction.reply('👍 Rolle gesetzt.');

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

        await interaction.reply('👍 Wartezeit aktualisiert.');

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

        await interaction.reply('👍 Verlassenzeit aktualisiert.');

        break;
      }

      case 'get': {
        const embed = new MessageEmbed().setTitle('Config');

        const config = await prisma.setting.findUnique({where: {guildId: interaction.guild!.id}});

        if (!config) {
          throw new Error('Keine gesetzten Einstellungen gefunden!');
        }

        const settingsToShow = {
          'Playlist Song Limit': config.playlistLimit,
          Role: config.roleId ? `<@&${config.roleId}>` : 'Nicht gesetzt.',
          'Zeit zum warten bevor ich den Channel verlasse': config.secondsToWaitAfterQueueEmpties === 0
            ? 'Niemals den Channel verlassen.'
            : `${config.secondsToWaitAfterQueueEmpties}s`,
          'Verlassen wenn keiner mehr da ist?': config.leaveIfNoListeners ? 'Ja' : 'Nein',
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
        throw new Error('Unbekannter Befehl!');
    }
  }
}
