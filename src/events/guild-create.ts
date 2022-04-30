import {AuditLogEvent, Client, Guild} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v10';
import updatePermissionsForGuild from '../utils/update-permissions-for-guild.js';
import Token from '../managers/token';

export default async (guild: Guild): Promise<void> => {
  let invitedBy;
  try {
    const logs = await guild.fetchAuditLogs({type: AuditLogEvent.BotAdd});
    invitedBy = logs.entries.find(entry => entry.target?.id === guild.client.user?.id)?.executor;
  } catch {}

  if (!invitedBy) {
    console.warn(`Could not find user who invited Muse to ${guild.name} from the audit logs.`);
  }

  await prisma.setting.upsert({
    where: {
      guildId: guild.id,
    },
    create: {
      guildId: guild.id,
      invitedByUserId: invitedBy?.id,
    },
    update: {
      invitedByUserId: invitedBy?.id,
    },
  });

  const config = container.get<Config>(TYPES.Config);

  // Setup slash commands
  if (!config.REGISTER_COMMANDS_ON_BOT) {
    const token = container.get<Token>(TYPES.Managers.Token).getBearerToken();
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '10', authPrefix: 'Bearer'}).setToken(token);

    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, guild.id),
      {body: container.getAll<Command>(TYPES.Command).map(command => command.slashCommand.toJSON())},
    );
  }

  await updatePermissionsForGuild(guild);

  if (invitedBy) {
    await invitedBy.send('👋 Hi! You just invited me to a server. I can\'t be used by your server members until you complete setup by running /config set-role in your server.');
  } else {
    const owner = await guild.fetchOwner();
    await owner.send('👋 Hi! Someone (probably you) just invited me to a server you own. I can\'t be used by your server members until you complete setup by running /config set-role in your server.');
  }
};
