import {EmbedBuilder, Message, PartialMessage, TextChannel, User} from 'discord.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';

export interface DeletedMessageSnipe {
  guildId: string;
  channelId: string;
  authorId: string;
  authorTag: string;
  content: string;
  attachmentUrls: string[];
  deletedAt: Date;
}

const MAX_SNIPES_PER_GUILD = 50;
const deletedMessagesByGuild = new Map<string, DeletedMessageSnipe[]>();

const getContent = (message: Message | PartialMessage) => {
  const content = message.content?.trim();
  return content && content.length > 0 ? content : '[no text content]';
};

const getAttachmentUrls = (message: Message | PartialMessage) => message.attachments.map(attachment => attachment.url);

const getAuthor = (message: Message | PartialMessage): User | null => message.author ?? null;

const sendToLogChannel = async (message: Message | PartialMessage, embed: EmbedBuilder) => {
  if (!message.guild) {
    return;
  }

  const settings = await getGuildSettings(message.guild.id);
  if (!settings.messageLogChannelId) {
    return;
  }

  const channel = message.guild.channels.cache.get(settings.messageLogChannelId) ?? await message.guild.channels.fetch(settings.messageLogChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  await (channel as TextChannel).send({embeds: [embed]});
};

export function getDeletedMessageSnipe(guildId: string, userId?: string): DeletedMessageSnipe | null {
  const snipes = deletedMessagesByGuild.get(guildId) ?? [];
  return snipes.find(snipe => !userId || snipe.authorId === userId) ?? null;
}

export async function handleMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guild || message.partial) {
    return;
  }

  const author = getAuthor(message);
  if (!author || author.bot) {
    return;
  }

  const settings = await getGuildSettings(message.guild.id);
  const snipe: DeletedMessageSnipe = {
    guildId: message.guild.id,
    channelId: message.channel.id,
    authorId: author.id,
    authorTag: author.tag,
    content: getContent(message),
    attachmentUrls: getAttachmentUrls(message),
    deletedAt: new Date(),
  };

  const snipes = [snipe, ...(deletedMessagesByGuild.get(message.guild.id) ?? [])].slice(0, MAX_SNIPES_PER_GUILD);
  deletedMessagesByGuild.set(message.guild.id, snipes);

  if (!settings.logDeletedMessages) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Message Deleted')
    .setDescription(snipe.content)
    .addFields([
      {name: 'Author', value: `<@${author.id}> (${author.tag})`, inline: true},
      {name: 'Channel', value: `<#${message.channel.id}>`, inline: true},
    ])
    .setTimestamp(snipe.deletedAt);

  if (snipe.attachmentUrls.length > 0) {
    embed.addFields({name: 'Attachments', value: snipe.attachmentUrls.join('\n').slice(0, 1024)});
  }

  await sendToLogChannel(message, embed);
}

export async function handleMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
  if (!oldMessage.guild || oldMessage.partial || newMessage.partial) {
    return;
  }

  const author = getAuthor(newMessage);
  if (!author || author.bot || oldMessage.content === newMessage.content) {
    return;
  }

  const settings = await getGuildSettings(oldMessage.guild.id);
  if (!settings.logEditedMessages) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('Message Edited')
    .addFields([
      {name: 'Author', value: `<@${author.id}> (${author.tag})`, inline: true},
      {name: 'Channel', value: `<#${oldMessage.channel.id}>`, inline: true},
      {name: 'Before', value: getContent(oldMessage).slice(0, 1024)},
      {name: 'After', value: getContent(newMessage).slice(0, 1024)},
    ])
    .setTimestamp();

  await sendToLogChannel(oldMessage, embed);
}
