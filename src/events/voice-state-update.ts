import {VoiceState} from 'discord.js';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';

export default (oldState: VoiceState, _: VoiceState): void => {
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  const player = playerManager.get(oldState.guild.id);

  if (player.voiceConnection) {
    if (getSizeWithoutBots(player.voiceConnection.channel) === 0) {
      player.disconnect();
    }
  }
};
