import {EmbedBuilder, VoiceChannel, VoiceState} from 'discord.js';
import {VoiceConnectionStatus} from '@discordjs/voice';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {sendToLogChannel} from './message-log.js';

export default async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
  await logVoiceStateUpdate(oldState, newState);

  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  const player = playerManager.get(oldState.guild.id);

  if (!player.voiceConnection || player.voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
    return;
  }

  const {channelId} = player.voiceConnection.joinConfig;
  if (!channelId || (oldState.channelId !== channelId && newState.channelId !== channelId)) {
    return;
  }

  const voiceChannel = newState.guild.channels.cache.get(channelId) as VoiceChannel | undefined;
  const {leaveIfNoListeners} = await getGuildSettings(player.guildId);
  if (!voiceChannel || (getSizeWithoutBots(voiceChannel) === 0 && leaveIfNoListeners)) {
    player.disconnect();
  }
};

const logVoiceStateUpdate = async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) {
    return;
  }

  let title = '';
  let color = 0x5865F2;
  const fields = [
    {name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: false},
  ];

  if (!oldState.channelId && newState.channelId) {
    title = 'Voice Joined';
    color = 0x57F287;
    fields.push({name: 'Channel', value: `<#${newState.channelId}>`, inline: true});
  } else if (oldState.channelId && !newState.channelId) {
    title = 'Voice Left';
    color = 0xED4245;
    fields.push({name: 'Channel', value: `<#${oldState.channelId}>`, inline: true});
  } else if (oldState.channelId !== newState.channelId && oldState.channelId && newState.channelId) {
    title = 'Voice Moved';
    fields.push({name: 'From', value: `<#${oldState.channelId}>`, inline: true});
    fields.push({name: 'To', value: `<#${newState.channelId}>`, inline: true});
  } else if (oldState.serverMute !== newState.serverMute) {
    title = newState.serverMute ? 'User Server Muted' : 'User Server Unmuted';
    color = newState.serverMute ? 0xFEE75C : 0x57F287;
    fields.push({name: 'Channel', value: newState.channelId ? `<#${newState.channelId}>` : 'Unknown', inline: true});
  } else if (oldState.serverDeaf !== newState.serverDeaf) {
    title = newState.serverDeaf ? 'User Server Deafened' : 'User Server Undeafened';
    color = newState.serverDeaf ? 0xFEE75C : 0x57F287;
    fields.push({name: 'Channel', value: newState.channelId ? `<#${newState.channelId}>` : 'Unknown', inline: true});
  } else if (oldState.selfMute !== newState.selfMute) {
    title = newState.selfMute ? 'User Self Muted' : 'User Self Unmuted';
    fields.push({name: 'Channel', value: newState.channelId ? `<#${newState.channelId}>` : 'Unknown', inline: true});
  } else if (oldState.selfDeaf !== newState.selfDeaf) {
    title = newState.selfDeaf ? 'User Self Deafened' : 'User Self Undeafened';
    fields.push({name: 'Channel', value: newState.channelId ? `<#${newState.channelId}>` : 'Unknown', inline: true});
  } else {
    return;
  }

  await sendToLogChannel(newState.guild, new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp());
};
