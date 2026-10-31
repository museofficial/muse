import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import Command from './index.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {LocalizedError, t} from '../i18n/index.js';
import {localizeCommand} from '../i18n/commands.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = localizeCommand(new SlashCommandBuilder()
    .setName('config')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(subcommand => subcommand
      .setName('set-playlist-limit')
      .addIntegerOption(option => option
        .setName('limit')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-wait-after-queue-empties')
      .addIntegerOption(option => option
        .setName('delay')
        .setRequired(true)
        .setMinValue(0)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-if-no-listeners')
      .addBooleanOption(option => option
        .setName('value')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice')
      .addBooleanOption(option => option
        .setName('value')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice-target')
      .addIntegerOption(option => option
        .setName('volume')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-auto-announce-next-song')
      .addBooleanOption(option => option
        .setName('value')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-volume')
      .addIntegerOption(option => option
        .setName('level')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-queue-page-size')
      .addIntegerOption(option => option
        .setName('page-size')
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('get')));

  async execute(interaction: ChatInputCommandInteraction) {
    const {locale} = interaction;

    // Ensure guild settings exist before trying to update
    await getGuildSettings(interaction.guild!.id);

    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit: number = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new LocalizedError('config.error.invalidLimit');
        }

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            playlistLimit: limit,
          },
        });

        await interaction.reply(t(locale, 'config.updated.playlistLimit'));

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

        await interaction.reply(t(locale, 'config.updated.waitAfterQueueEmpties'));

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

        await interaction.reply(t(locale, 'config.updated.leaveIfNoListeners'));

        break;
      }

      case 'set-auto-announce-next-song': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            autoAnnounceNextSong: value,
          },
        });

        await interaction.reply(t(locale, 'config.updated.autoAnnounceNextSong'));

        break;
      }

      case 'set-default-volume': {
        const value = interaction.options.getInteger('level')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            defaultVolume: value,
          },
        });

        await interaction.reply(t(locale, 'config.updated.defaultVolume'));

        break;
      }

      case 'set-default-queue-page-size': {
        const value = interaction.options.getInteger('page-size')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            defaultQueuePageSize: value,
          },
        });

        await interaction.reply(t(locale, 'config.updated.defaultQueuePageSize'));

        break;
      }

      case 'set-reduce-vol-when-voice': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            turnDownVolumeWhenPeopleSpeak: value,
          },
        });

        await interaction.reply(t(locale, 'config.updated.reduceVolWhenVoice'));

        break;
      }

      case 'set-reduce-vol-when-voice-target': {
        const value = interaction.options.getInteger('volume')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            turnDownVolumeWhenPeopleSpeakTarget: value,
          },
        });

        await interaction.reply(t(locale, 'config.updated.reduceVolWhenVoiceTarget'));

        break;
      }

      case 'get': {
        const embed = new EmbedBuilder().setTitle(t(locale, 'config.title'));

        const config = await getGuildSettings(interaction.guild!.id);
        const yesNo = (value: boolean) => t(locale, value ? 'config.value.yes' : 'config.value.no');

        const settingsToShow = {
          [t(locale, 'config.label.playlistLimit')]: config.playlistLimit,
          [t(locale, 'config.label.waitAfterQueueEmpties')]: config.secondsToWaitAfterQueueEmpties === 0
            ? t(locale, 'config.value.neverLeave')
            : t(locale, 'config.value.seconds', {seconds: config.secondsToWaitAfterQueueEmpties}),
          [t(locale, 'config.label.leaveIfNoListeners')]: yesNo(config.leaveIfNoListeners),
          [t(locale, 'config.label.autoAnnounceNextSong')]: yesNo(config.autoAnnounceNextSong),
          [t(locale, 'config.label.defaultVolume')]: config.defaultVolume,
          [t(locale, 'config.label.defaultQueuePageSize')]: config.defaultQueuePageSize,
          [t(locale, 'config.label.reduceVolWhenVoice')]: yesNo(config.turnDownVolumeWhenPeopleSpeak),
          [t(locale, 'config.label.reduceVolWhenVoiceTarget')]: config.turnDownVolumeWhenPeopleSpeakTarget,
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
        throw new LocalizedError('error.unknownSubcommand');
    }
  }
}
