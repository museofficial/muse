import {
  ApplicationCommandPermissionType,
  ApplicationCommandPermissions,
  ApplicationCommandType,
  GuildMember,
  Message,
  PermissionFlagsBits,
} from 'discord.js';

const memberAccess = (permissions: ApplicationCommandPermissions[], member: GuildMember): boolean | undefined => {
  const user = permissions.find(permission => permission.type === ApplicationCommandPermissionType.User
    && permission.id === member.id);
  if (user) {
    return user.permission;
  }

  const roles = permissions.filter(permission => permission.type === ApplicationCommandPermissionType.Role
    && permission.id !== member.guild.id && member.roles.cache.has(permission.id));
  if (roles.length > 0) {
    // As with channel overwrites, an allow from any matching role wins.
    return roles.some(role => role.permission);
  }

  return permissions.find(permission => permission.type === ApplicationCommandPermissionType.Role
    && permission.id === member.guild.id)?.permission;
};

const channelAccess = (permissions: ApplicationCommandPermissions[], channelId: string, guildId: string): boolean => {
  const channels = permissions.filter(permission => permission.type === ApplicationCommandPermissionType.Channel);
  // Discord represents "All Channels" using the guild snowflake minus one.
  return (channels.find(permission => permission.id === channelId)
    ?? channels.find(permission => permission.id === (BigInt(guildId) - 1n).toString()))?.permission ?? true;
};

// Command overwrites replace matching targets, leaving other application-wide
// restrictions in force. A channel overwrite must not erase a role restriction.
const mergePermissions = (
  application: ApplicationCommandPermissions[],
  command: ApplicationCommandPermissions[],
): ApplicationCommandPermissions[] => {
  const merged = new Map(application.map(permission => [`${permission.type}:${permission.id}`, permission]));
  for (const permission of command) {
    merged.set(`${permission.type}:${permission.id}`, permission);
  }

  return [...merged.values()];
};

/** Reactions are not interactions: Discord does not authorize them as commands. */
const canUsePlaybackCommand = async (message: Message, userId: string, commandName: string): Promise<boolean> => {
  if (!message.inGuild()) {
    return false;
  }

  try {
    const {guild, client} = message;
    const {application} = client;
    if (!application) {
      return false;
    }

    // Read registrations and permissions afresh for every queued action. Never
    // reuse an earlier allow after an administrator changes access or roles.
    const guildCommands = await guild.commands.fetch();
    const matchesCommand = (command: {name: string; type: ApplicationCommandType}) =>
      command.name === commandName && command.type === ApplicationCommandType.ChatInput;
    const command = guildCommands.find(matchesCommand)
      ?? (await application.commands.fetch()).find(matchesCommand);
    if (!command) {
      return false;
    }

    const [permissions, member, channel] = await Promise.all([
      guild.commands.permissions.fetch({}),
      guild.members.fetch({user: userId, force: true}),
      guild.channels.fetch(message.channelId, {force: true}),
      guild.roles.fetch(),
    ]);
    if (!channel?.isTextBased()) {
      return false;
    }

    // Threads inherit command restrictions and channel overwrites from their
    // parent. Refresh the parent before resolving the member's channel rights.
    if (channel.isThread() && (!channel.parentId || !await guild.channels.fetch(channel.parentId, {force: true}))) {
      return false;
    }

    const memberPermissions = channel.permissionsFor(member);
    if (!memberPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.UseApplicationCommands])) {
      return false;
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    const commandPermissions = permissions.get(command.id) ?? [];
    const effectivePermissions = mergePermissions(permissions.get(application.id) ?? [], commandPermissions);
    const commandChannelId = channel.isThread() ? channel.parentId! : channel.id;
    if (!channelAccess(effectivePermissions, commandChannelId, guild.id)
      || memberAccess(effectivePermissions, member) === false) {
      return false;
    }

    // Application-wide grants do not override a command's developer defaults.
    // Only an explicit grant on this command can do so (including a zero mask).
    // https://support-apps.discord.com/hc/en-us/articles/26501842915607
    const defaults = command.defaultMemberPermissions;
    return memberAccess(commandPermissions, member) === true
      || defaults === null
      || (defaults.bitfield !== 0n && memberPermissions.has(defaults));
  } catch {
    // Missing access, a deleted channel/member, or a Discord API outage must
    // never turn a permission lookup failure into permission to control music.
    return false;
  }
};

export default canUsePlaybackCommand;
