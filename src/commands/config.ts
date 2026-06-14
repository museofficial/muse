import {SlashCommandBuilder} from '@discordjs/builders';
import {ChannelType, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import Command from './index.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('configure bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(subcommand => subcommand
      .setName('set-playlist-limit')
      .setDescription('set the maximum number of tracks that can be added from a playlist')
      .addIntegerOption(option => option
        .setName('limit')
        .setDescription('maximum number of tracks')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-wait-after-queue-empties')
      .setDescription('set the time to wait before leaving the voice channel when queue empties')
      .addIntegerOption(option => option
        .setName('delay')
        .setDescription('delay in seconds (set to 0 to never leave)')
        .setRequired(true)
        .setMinValue(0)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-if-no-listeners')
      .setDescription('set whether to leave when all other participants leave')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to leave when everyone else leaves')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-queue-add-response-hidden')
      .setDescription('set whether bot responses to queue additions are only displayed to the requester')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether bot responses to queue additions are only displayed to the requester')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice')
      .setDescription('set whether to turn down the volume when people speak')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to turn down the volume when people speak')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice-target')
      .setDescription('set the target volume when people speak')
      .addIntegerOption(option => option
        .setName('volume')
        .setDescription('volume percentage (0 is muted, 100 is max & default)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-auto-announce-next-song')
      .setDescription('set whether to announce the next song in the queue automatically')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('whether to announce the next song in the queue automatically')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-volume')
      .setDescription('set default volume used when entering the voice channel')
      .addIntegerOption(option => option
        .setName('level')
        .setDescription('volume percentage (0 is muted, 100 is max & default)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-queue-page-size')
      .setDescription('set the default page size of the /queue command')
      .addIntegerOption(option => option
        .setName('page-size')
        .setDescription('page size of the /queue command')
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-welcome-channel')
      .setDescription('set where welcome messages are posted')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('welcome channel')
        .addChannelTypes([ChannelType.GuildText])
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('clear-welcome-channel')
      .setDescription('turn off welcome messages'))
    .addSubcommand(subcommand => subcommand
      .setName('set-welcome-message')
      .setDescription('set the welcome message. Supports {user}, {username}, {server}, {memberCount}')
      .addStringOption(option => option
        .setName('message')
        .setDescription('message template')
        .setMaxLength(500)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-channel')
      .setDescription('set where leave messages are posted')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('leave channel')
        .addChannelTypes([ChannelType.GuildText])
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('clear-leave-channel')
      .setDescription('turn off leave messages'))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-message')
      .setDescription('set the leave message. Supports {user}, {username}, {server}, {memberCount}')
      .addStringOption(option => option
        .setName('message')
        .setDescription('message template')
        .setMaxLength(500)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('get')
      .setDescription('show all settings'));

  async execute(interaction: ChatInputCommandInteraction) {
    // Ensure guild settings exist before trying to update
    await getGuildSettings(interaction.guild!.id);

    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit: number = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new Error('invalid limit');
        }

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            playlistLimit: limit,
          },
        });

        await interaction.reply('👍 limit updated');

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

        await interaction.reply('👍 wait delay updated');

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

        await interaction.reply('👍 leave setting updated');

        break;
      }

      case 'set-queue-add-response-hidden': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            queueAddResponseEphemeral: value,
          },
        });

        await interaction.reply('👍 queue add notification setting updated');

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

        await interaction.reply('👍 auto announce setting updated');

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

        await interaction.reply('👍 volume setting updated');

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

        await interaction.reply('👍 default queue page size updated');

        break;
      }

      case 'set-welcome-channel': {
        const channel = interaction.options.getChannel('channel', true);

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            welcomeChannelId: channel.id,
          },
        });

        await interaction.reply(`welcome messages will go to <#${channel.id}>`);

        break;
      }

      case 'clear-welcome-channel': {
        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            welcomeChannelId: null,
          },
        });

        await interaction.reply('welcome messages disabled');

        break;
      }

      case 'set-welcome-message': {
        const message = interaction.options.getString('message', true);

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            welcomeMessage: message,
          },
        });

        await interaction.reply('welcome message updated');

        break;
      }

      case 'set-leave-channel': {
        const channel = interaction.options.getChannel('channel', true);

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            leaveChannelId: channel.id,
          },
        });

        await interaction.reply(`leave messages will go to <#${channel.id}>`);

        break;
      }

      case 'clear-leave-channel': {
        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            leaveChannelId: null,
          },
        });

        await interaction.reply('leave messages disabled');

        break;
      }

      case 'set-leave-message': {
        const message = interaction.options.getString('message', true);

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            leaveMessage: message,
          },
        });

        await interaction.reply('leave message updated');

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

        await interaction.reply('👍 turn down volume setting updated');

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

        await interaction.reply('👍 turn down volume target setting updated');

        break;
      }

      case 'get': {
        const embed = new EmbedBuilder().setTitle('Config');

        const config = await getGuildSettings(interaction.guild!.id);

        const settingsToShow = {
          'Playlist Limit': config.playlistLimit,
          'Wait before leaving after queue empty': config.secondsToWaitAfterQueueEmpties === 0
            ? 'never leave'
            : `${config.secondsToWaitAfterQueueEmpties}s`,
          'Leave if there are no listeners': config.leaveIfNoListeners ? 'yes' : 'no',
          'Auto announce next song in queue': config.autoAnnounceNextSong ? 'yes' : 'no',
          'Add to queue responses show for requester only': config.queueAddResponseEphemeral ? 'yes' : 'no',
          'Default Volume': config.defaultVolume,
          'Default queue page size': config.defaultQueuePageSize,
          'Reduce volume when people speak': config.turnDownVolumeWhenPeopleSpeak ? 'yes' : 'no',
          'Welcome channel': config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'disabled',
          'Welcome message': config.welcomeMessage,
          'Leave channel': config.leaveChannelId ? `<#${config.leaveChannelId}>` : 'disabled',
          'Leave message': config.leaveMessage,
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
