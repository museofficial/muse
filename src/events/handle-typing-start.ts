import {Channel, TextChannel, PartialDMChannel, User, PartialUser} from 'discord.js';

const WAIT_TIME_SECONDS = 12;

export default (channel: Channel | PartialDMChannel, user: User | PartialUser): void => {
  if (channel.type !== 'text') {
    return;
  }

  const textChannel = channel as TextChannel;

  setTimeout(async () => {
    if (user.typingIn(channel)) {
      const msg = await textChannel.send(`take your time why don'tcha <@${user.id}>`);

      setTimeout(async () => {
        await msg.delete();
      }, 2000);
    }
  }, WAIT_TIME_SECONDS * 1000); // Discord sends typing updates every 10s
};
