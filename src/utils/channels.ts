import {Guild, VoiceChannel} from 'discord.js';

export const getMostPopularVoiceChannel = (guild: Guild, min = 0): VoiceChannel => {
  interface PopularResult {
    n: number;
    channel: VoiceChannel | null;
  }

  const voiceChannels: PopularResult[] = [];

  for (const [_, channel] of guild.channels.cache) {
    if (channel.type === 'voice' && channel.members.size >= min) {
      voiceChannels.push({
        channel: channel as VoiceChannel,
        n: channel.members.size
      });
    }
  }

  if (voiceChannels.length === 0) {
    throw new Error('No voice channels meet minimum size');
  }

  // Find most popular channel
  const popularChannel = voiceChannels.reduce((popular: PopularResult, elem: PopularResult) => {
    if (elem.n > popular.n) {
      return elem;
    }

    return popular;
  }, {n: -1, channel: null});

  if (popularChannel.channel) {
    return popularChannel.channel;
  }

  throw new Error();
};
