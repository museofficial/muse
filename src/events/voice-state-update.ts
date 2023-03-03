import {VoiceChannel, VoiceState} from 'discord.js';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings';

export default async (oldState: VoiceState, _: VoiceState): Promise<void> => {
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  const player = playerManager.get(oldState.guild.id);

  if (player.voiceConnection) {
    const voiceChannel: VoiceChannel = oldState.guild.channels.cache.get(player.voiceConnection.joinConfig.channelId!) as VoiceChannel;
    const settings = await getGuildSettings(player.guildId);

    const {leaveIfNoListeners} = settings;
    if (!voiceChannel || (getSizeWithoutBots(voiceChannel) === 0 && leaveIfNoListeners)) {
      player.disconnect();
    }
  }
};
