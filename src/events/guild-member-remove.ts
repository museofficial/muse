import {GuildMember, PartialGuildMember} from 'discord.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {formatMemberMessage, sendMemberMessage} from '../utils/member-messages.js';

export default async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const settings = await getGuildSettings(member.guild.id);
  const message = formatMemberMessage(settings.leaveMessage, member);

  await sendMemberMessage(settings.leaveChannelId, member, {content: message});
}
