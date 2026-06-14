import {GuildMember} from 'discord.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildWelcomeEmbed, formatMemberMessage, sendMemberMessage} from '../utils/member-messages.js';

export default async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  const settings = await getGuildSettings(member.guild.id);
  const message = formatMemberMessage(settings.welcomeMessage, member);

  await sendMemberMessage(settings.welcomeChannelId, member, {
    content: message,
    embeds: [buildWelcomeEmbed(member, message)],
  });
}
