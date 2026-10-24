import {VoiceChannel, VoiceState} from 'discord.js';
import {VoiceConnectionStatus} from '@discordjs/voice';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';

export default async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  const player = playerManager.get(oldState.guild.id);

  const {voiceConnection} = player;
  if (!voiceConnection || voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
    return;
  }

  const {channelId} = voiceConnection.joinConfig;
  if (!channelId || (oldState.channelId !== channelId && newState.channelId !== channelId)) {
    return;
  }

  const {leaveIfNoListeners} = await getGuildSettings(player.guildId);
  // A settings lookup can outlive a move, reconnect, or disconnect.
  if (player.voiceConnection !== voiceConnection
    || voiceConnection.state.status !== VoiceConnectionStatus.Ready
    || voiceConnection.joinConfig.channelId !== channelId) {
    return;
  }

  const voiceChannel = newState.guild.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (!voiceChannel || (getSizeWithoutBots(voiceChannel) === 0 && leaveIfNoListeners)) {
    player.disconnect();
  }
};
