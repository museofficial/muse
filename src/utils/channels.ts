import {Guild, VoiceChannel, User, GuildMember} from 'discord.js';

export const isUserInVoice = (guild: Guild, user: User): boolean => {
  let inVoice = false;

  guild.channels.cache.filter(channel => channel.type === 'GUILD_VOICE').forEach(channel => {
    if ((channel as VoiceChannel).members.find(member => member.id === user.id)) {
      inVoice = true;
    }
  });

  return inVoice;
};

export const getSizeWithoutBots = (channel: VoiceChannel): number => channel.members.reduce((s, member) => {
  if (!member.user.bot) {
    s++;
  }

  return s;
}, 0);

export const getMemberVoiceChannel = (member?: GuildMember): [VoiceChannel, number] | null => {
  const channel = member?.voice?.channel;
  if (channel && channel.type === 'GUILD_VOICE') {
    return [
      channel,
      getSizeWithoutBots(channel),
    ];
  }

  return null;
};

export const getMostPopularVoiceChannel = (guild: Guild): [VoiceChannel, number] => {
  interface PopularResult {
    n: number;
    channel: VoiceChannel | null;
  }

  const voiceChannels: PopularResult[] = [];

  for (const [_, channel] of guild.channels.cache) {
    if (channel.type === 'GUILD_VOICE') {
      const size = getSizeWithoutBots(channel);

      voiceChannels.push({
        channel,
        n: size,
      });
    }
  }

  // Find most popular channel
  const popularChannel = voiceChannels.reduce((popular: PopularResult, elem: PopularResult) => {
    if (elem.n > popular.n) {
      return elem;
    }

    return popular;
  }, {n: -1, channel: null});

  if (popularChannel.channel) {
    return [popularChannel.channel, popularChannel.n];
  }

  throw new Error();
};
