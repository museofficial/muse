import {EmbedBuilder, GuildMember} from 'discord.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildWelcomeEmbed, formatDuration, formatMemberMessage, sendMemberMessage} from '../utils/member-messages.js';
import {sendToLogChannel} from './message-log.js';

export default async function handleGuildMemberAdd(member: GuildMember): Promise<void> {
  const settings = await getGuildSettings(member.guild.id);
  const message = formatMemberMessage(settings.welcomeMessage, member);

  await sendMemberMessage(settings.welcomeChannelId, member, {
    content: message,
    embeds: [buildWelcomeEmbed(member, message)],
  });

  await sendToLogChannel(member.guild, new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('Member Joined')
    .setThumbnail(member.user.displayAvatarURL({size: 128}))
    .addFields([
      {name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: true},
      {name: 'Account Age', value: formatDuration(member.user.createdAt), inline: true},
      {name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: false},
    ])
    .setTimestamp());
}
