import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {injectable} from 'inversify';
import Command from './index.js';
import {getDeletedMessageSnipe} from '../events/message-log.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('show the most recently deleted message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addUserOption(option => option
      .setName('user')
      .setDescription('only show the most recent deleted message from this user')
      .setRequired(false));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user');
    const snipe = getDeletedMessageSnipe(interaction.guild!.id, user?.id);

    if (!snipe) {
      throw new Error(user ? 'no deleted message cached for that user' : 'no deleted message cached');
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(user ? `Last deleted message from ${snipe.authorTag}` : 'Last deleted message')
      .setDescription(snipe.content)
      .addFields([
        {name: 'Author', value: `<@${snipe.authorId}> (${snipe.authorTag})`, inline: true},
        {name: 'Channel', value: `<#${snipe.channelId}>`, inline: true},
        {name: 'Deleted', value: `<t:${Math.floor(snipe.deletedAt.getTime() / 1000)}:R>`, inline: true},
      ])
      .setTimestamp(snipe.deletedAt);

    if (snipe.attachmentUrls.length > 0) {
      embed.addFields({name: 'Attachments', value: snipe.attachmentUrls.join('\n').slice(0, 1024)});
    }

    await interaction.reply({embeds: [embed], ephemeral: true});
  }
}
