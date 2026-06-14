import {EmbedBuilder, GuildMember, PartialGuildMember} from 'discord.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {formatMemberMessage, sendMemberMessage} from '../utils/member-messages.js';
import {sendToLogChannel} from './message-log.js';

export default async function handleGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const settings = await getGuildSettings(member.guild.id);
  const message = formatMemberMessage(settings.leaveMessage, member);

  await sendMemberMessage(settings.leaveChannelId, member, {content: message});

  await sendToLogChannel(member.guild, new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Member Left')
    .setThumbnail(member.user.displayAvatarURL({size: 128}))
    .addFields([
      {name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: true},
      {name: 'Joined Server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown', inline: false},
    ])
    .setTimestamp());
}
