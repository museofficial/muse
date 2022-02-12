import {VoiceChannel, VoiceState} from 'discord.js';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {prisma} from '../utils/db.js';

export default async (oldState: VoiceState, _: VoiceState): Promise<void> => {
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  const player = playerManager.get(oldState.guild.id);

  if (player.voiceConnection) {
    const voiceChannel: VoiceChannel = oldState.guild.channels.cache.get(player.voiceConnection.joinConfig.channelId!) as VoiceChannel;
    const settings = await prisma.setting.findUnique({where: {guildId: player.guildId}});

    if (!settings) {
      throw new Error('Could not find settings for guild');
    }

    const {leaveIfNoListeners} = settings;
    if (!voiceChannel || (getSizeWithoutBots(voiceChannel) === 0 && leaveIfNoListeners)) {
      player.disconnect();
    }
  }
};
