import {Guild, MessageReaction, TextChannel} from 'discord.js';
import emoji from 'node-emoji';
import {Settings} from '../models';

const DEFAULT_PREFIX = '!';

export default async (guild: Guild): Promise<void> => {
  await Settings.upsert({guildId: guild.id, prefix: DEFAULT_PREFIX});

  const owner = await guild.client.users.fetch(guild.ownerID);

  let firstStep = '👋 Hi!\n';
  firstStep += 'I just need to ask a few questions before you start listening to music.\n\n';
  firstStep += 'First, what channel should I listen to for music commands?\n\n';

  interface EmojiChannel {
    name: string;
    id: string;
    emoji: string;
  }

  const emojiChannels: EmojiChannel[] = [];

  for (const [channelId, channel] of guild.channels.cache) {
    if (channel.type === 'text') {
      emojiChannels.push({
        name: channel.name,
        id: channelId,
        emoji: emoji.random().emoji
      });
    }
  }

  for (const channel of emojiChannels) {
    firstStep += `${channel.emoji}: #${channel.name}\n`;
  }

  firstStep += '\n';

  // Send message
  const msg = await owner.send(firstStep);

  // Add reactions
  for await (const channel of emojiChannels) {
    await msg.react(channel.emoji);
  }

  const reactions = await msg.awaitReactions((reaction, user) => user.id !== msg.author.id && emojiChannels.map(e => e.emoji).includes(reaction.emoji.name), {max: 1});

  const choice = reactions.first() as MessageReaction;

  const chosenChannel = emojiChannels.find(e => e.emoji === choice.emoji.name) as EmojiChannel;

  // Second setup step (get prefix)
  let secondStep = `👍 Cool, I'll listen to **#${chosenChannel.name}** \n\n`;
  secondStep += 'Last question: what character should I use for a prefix? Type a single character and hit enter.';

  await owner.send(secondStep);

  const prefixResponses = await msg.channel.awaitMessages(r => r.content.length === 1, {max: 1});

  const prefixCharacter = prefixResponses.first()!.content;

  // Save settings
  await Settings.update({prefix: prefixCharacter, channel: chosenChannel.id}, {where: {guildId: guild.id}});

  // Send welcome
  const boundChannel = guild.client.channels.cache.get(chosenChannel.id) as TextChannel;

  await boundChannel.send(`hey <@${owner.id}> try \`${prefixCharacter}play https://www.youtube.com/watch?v=dQw4w9WgXcQ\``);

  await msg.channel.send(`Sounds good. Check out **#${chosenChannel.name}** to get started.`);
};
