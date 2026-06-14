import {EmbedBuilder, GuildMember, PartialGuildMember, TextChannel} from 'discord.js';

type KnownMember = GuildMember | PartialGuildMember;

export function formatMemberMessage(template: string, member: KnownMember): string {
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{tag}', member.user.tag)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{memberCount}', member.guild.memberCount.toString());
}

export function buildWelcomeEmbed(member: GuildMember, message: string): EmbedBuilder {
  const createdAt = Math.floor(member.user.createdTimestamp / 1000);
  const joinedAt = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

  const embed = new EmbedBuilder()
    .setColor(0x00E5A8)
    .setTitle('New Member Joined')
    .setDescription(message)
    .setThumbnail(member.user.displayAvatarURL({size: 256}))
    .addFields([
      {name: 'User ID', value: member.id, inline: true},
      {name: 'Username', value: member.user.username, inline: true},
      {name: 'Account Created', value: `<t:${createdAt}:F>`, inline: true},
      {name: 'Members', value: member.guild.memberCount.toString(), inline: true},
    ])
    .setFooter({text: member.guild.name})
    .setTimestamp();

  if (joinedAt) {
    embed.addFields({name: 'Joined Server', value: `<t:${joinedAt}:F>`, inline: true});
  }

  return embed;
}

export async function sendMemberMessage(channelId: string | null, member: KnownMember, payload: {content?: string; embeds?: EmbedBuilder[]}): Promise<void> {
  if (!channelId) {
    return;
  }

  const channel = member.guild.channels.cache.get(channelId) ?? await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  await (channel as TextChannel).send(payload);
}
