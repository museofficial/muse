import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {injectable} from 'inversify';
import Command from './index.js';

const formatTimestamp = (timestamp: number | null) => timestamp
  ? `<t:${Math.floor(timestamp / 1000)}:F>\n<t:${Math.floor(timestamp / 1000)}:R>`
  : 'Unknown';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('show useful information about a server member')
    .addUserOption(option => option
      .setName('user')
      .setDescription('member to inspect')
      .setRequired(false));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);

    if (!member) {
      throw new Error('that user is not in this server');
    }

    const roleNames = member.roles.cache
      .filter(role => role.id !== interaction.guild!.id)
      .sort((a, b) => b.position - a.position)
      .map(role => `<@&${role.id}>`);

    const permissions = member.permissions.toArray()
      .filter(permission => permission !== 'Administrator')
      .slice(0, 12)
      .map(permission => permission.replaceAll(/([A-Z])/g, ' $1').trim())
      .join(', ');

    const embed = new EmbedBuilder()
      .setColor(member.displayHexColor === '#000000' ? 0x5865F2 : member.displayColor)
      .setTitle(member.displayName)
      .setThumbnail(member.displayAvatarURL({size: 256}))
      .addFields([
        {name: 'Username', value: user.tag, inline: true},
        {name: 'User ID', value: user.id, inline: true},
        {name: 'Bot Account', value: user.bot ? 'Yes' : 'No', inline: true},
        {name: 'Account Created', value: formatTimestamp(user.createdTimestamp), inline: true},
        {name: 'Joined Server', value: formatTimestamp(member.joinedTimestamp), inline: true},
        {name: 'Highest Role', value: member.roles.highest.id === interaction.guild!.id ? 'None' : `<@&${member.roles.highest.id}>`, inline: true},
        {name: `Roles (${roleNames.length})`, value: roleNames.length > 0 ? roleNames.slice(0, 20).join(', ') : 'None'},
        {name: 'Key Permissions', value: member.permissions.has(PermissionFlagsBits.Administrator) ? 'Administrator' : (permissions || 'None')},
      ])
      .setFooter({text: interaction.guild!.name})
      .setTimestamp();

    await interaction.reply({embeds: [embed]});
  }
}
