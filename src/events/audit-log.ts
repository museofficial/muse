import {AuditLogEvent, EmbedBuilder, GuildAuditLogsEntry} from 'discord.js';
import {sendToLogChannel} from './message-log.js';

const actionNames = new Map<number, {title: string; color: number}>([
  [AuditLogEvent.MemberKick, {title: 'Member Kicked', color: 0xED4245}],
  [AuditLogEvent.MemberBanAdd, {title: 'Member Banned', color: 0xED4245}],
  [AuditLogEvent.MemberBanRemove, {title: 'Member Unbanned', color: 0x57F287}],
  [AuditLogEvent.MemberUpdate, {title: 'Member Updated', color: 0xFEE75C}],
  [AuditLogEvent.MemberRoleUpdate, {title: 'Member Roles Updated', color: 0xFEE75C}],
  [AuditLogEvent.RoleCreate, {title: 'Role Created', color: 0x57F287}],
  [AuditLogEvent.RoleUpdate, {title: 'Role Updated', color: 0xFEE75C}],
  [AuditLogEvent.RoleDelete, {title: 'Role Deleted', color: 0xED4245}],
  [AuditLogEvent.ChannelCreate, {title: 'Channel Created', color: 0x57F287}],
  [AuditLogEvent.ChannelUpdate, {title: 'Channel Updated', color: 0xFEE75C}],
  [AuditLogEvent.ChannelDelete, {title: 'Channel Deleted', color: 0xED4245}],
  [AuditLogEvent.MessageDelete, {title: 'Message Deleted by Moderator', color: 0xED4245}],
  [AuditLogEvent.MessageBulkDelete, {title: 'Messages Bulk Deleted', color: 0xED4245}],
]);

const getTargetText = (entry: GuildAuditLogsEntry) => {
  const target = entry.target as {id?: string; tag?: string; name?: string; username?: string} | null;
  if (!target) {
    return 'Unknown';
  }

  if (target.tag) {
    return `<@${target.id}> (${target.tag})`;
  }

  if (target.username) {
    return `<@${target.id}> (${target.username})`;
  }

  return target.name ?? target.id ?? 'Unknown';
};

export default async function handleAuditLogEntryCreate(entry: GuildAuditLogsEntry): Promise<void> {
  const action = actionNames.get(entry.action);
  if (!action) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(action.color)
    .setTitle(action.title)
    .addFields([
      {name: 'Target', value: getTargetText(entry), inline: true},
      {name: 'Moderator', value: entry.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'Unknown', inline: true},
      {name: 'Reason', value: entry.reason ?? 'No reason provided', inline: false},
    ])
    .setTimestamp();

  await sendToLogChannel(entry.guild, embed);
}
