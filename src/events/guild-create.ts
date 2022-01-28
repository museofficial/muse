import {Guild, Client} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v9';

export default async (guild: Guild): Promise<void> => {
  await prisma.setting.upsert({
    where: {
      guildId: guild.id,
    },
    create: {
      guildId: guild.id,
    },
    update: {},
  });

  const config = container.get<Config>(TYPES.Config);

  // Setup slash commands
  if (!config.REGISTER_COMMANDS_ON_BOT) {
    const token = container.get<Config>(TYPES.Config).DISCORD_TOKEN;
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '9'}).setToken(token);

    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, guild.id),
      {body: container.getAll<Command>(TYPES.Command).map(command => command.slashCommand.toJSON())},
    );
  }
};
