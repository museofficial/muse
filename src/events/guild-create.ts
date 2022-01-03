import {Guild, TextChannel, Message, MessageReaction, User} from 'discord.js';
import emoji from 'node-emoji';
import pEvent from 'p-event';
import {chunk} from '../utils/arrays.js';
import {prisma} from '../utils/db.js';

const DEFAULT_PREFIX = '!';

export default async (guild: Guild): Promise<void> => {
  await prisma.setting.upsert({
    where: {
      guildId: guild.id,
    },
    create: {
      guildId: guild.id,
      prefix: DEFAULT_PREFIX,
    },
    update: {
      prefix: DEFAULT_PREFIX,
    },
  });

  const owner = await guild.client.users.fetch(guild.ownerId);

  let firstStep = '👋 Hi!\n';
  firstStep += 'I just need to ask a few questions before you start listening to music.\n\n';
  firstStep += 'First, what channel should I listen to for music commands?\n\n';

  const firstStepMsg = await owner.send(firstStep);

  // Show emoji selector
  interface EmojiChannel {
    name: string;
    id: string;
    emoji: string;
  }

  const emojiChannels: EmojiChannel[] = [];

  for (const [channelId, channel] of guild.channels.cache) {
    if (channel.type === 'GUILD_TEXT') {
      emojiChannels.push({
        name: channel.name,
        id: channelId,
        emoji: emoji.random().emoji,
      });
    }
  }

  const sentMessageIds: string[] = [];

  chunk(emojiChannels, 10).map(async chunk => {
    let str = '';
    for (const channel of chunk) {
      str += `${channel.emoji}: #${channel.name}\n`;
    }

    const msg = await owner.send(str);

    sentMessageIds.push(msg.id);

    await Promise.all(chunk.map(async channel => msg.react(channel.emoji)));
  });

  // Wait for response from user
  const [choice] = await pEvent(guild.client, 'messageReactionAdd', {
    multiArgs: true,
    filter: ([reaction, user]: [MessageReaction, User]) => sentMessageIds.includes(reaction.message.id) && user.id === owner.id,
  });

  const chosenChannel = emojiChannels.find(e => e.emoji === (choice as unknown as MessageReaction).emoji.name)!;

  // Second setup step (get prefix)
  let secondStep = `👍 Cool, I'll listen to **#${chosenChannel.name}** \n\n`;
  secondStep += 'Last question: what character should I use for a prefix? Type a single character and hit enter.';

  await owner.send(secondStep);

  const prefixResponses = await firstStepMsg.channel.awaitMessages({filter: (r: Message) => r.content.length === 1, max: 1});

  const prefixCharacter = prefixResponses.first()!.content;

  // Save settings
  await prisma.setting.update({
    where: {
      guildId: guild.id,
    },
    data: {
      channel: chosenChannel.id,
      prefix: prefixCharacter,
    },
  });

  // Send welcome
  const boundChannel = guild.client.channels.cache.get(chosenChannel.id) as TextChannel;

  await boundChannel.send(`hey <@${owner.id}> try \`${prefixCharacter}play https://www.youtube.com/watch?v=dQw4w9WgXcQ\``);

  await firstStepMsg.channel.send(`Sounds good. Check out **#${chosenChannel.name}** to get started.`);
};
