import {EmbedBuilder, GuildMember, PartialGuildMember, TextChannel} from 'discord.js';

type KnownMember = GuildMember | PartialGuildMember;

export function formatDuration(from: Date, to = new Date()): string {
  const seconds = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  const units = [
    {name: 'year', seconds: 31_536_000},
    {name: 'month', seconds: 2_592_000},
    {name: 'week', seconds: 604_800},
    {name: 'day', seconds: 86_400},
    {name: 'hour', seconds: 3600},
    {name: 'minute', seconds: 60},
  ];

  const parts: string[] = [];
  let remaining = seconds;
  for (const unit of units) {
    const value = Math.floor(remaining / unit.seconds);
    if (value > 0) {
      parts.push(`${value} ${unit.name}${value === 1 ? '' : 's'}`);
      remaining -= value * unit.seconds;
    }

    if (parts.length === 2) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(' and ') : 'less than 1 minute';
}

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
  const accountAge = formatDuration(member.user.createdAt);

  const embed = new EmbedBuilder()
    .setColor(0x7C5CFF)
    .setAuthor({name: 'Hellloo', iconURL: member.user.displayAvatarURL({size: 128})})
    .setTitle(member.user.tag)
    .setDescription(`${message}\n\nplease read the Rules`)
    .setThumbnail(member.user.displayAvatarURL({size: 256}))
    .addFields([
      {name: 'Username', value: member.user.username, inline: true},
      {name: 'User ID', value: member.id, inline: true},
      {name: 'Account Age', value: accountAge, inline: true},
      {name: 'Account Created', value: `<t:${createdAt}:F>`, inline: false},
      {name: 'Server Member', value: `#${member.guild.memberCount}`, inline: true},
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
