import {AuditLogEvent, Client, Guild, User} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Prisma, Setting} from '.prisma/client';
import registerCommandsOnGuild from '../utils/register-commands-on-guild.js';

export async function getInvitedByUser(guild: Guild): Promise<User | null | undefined> {
  let invitedBy;
  try {
    const logs = await guild.fetchAuditLogs({type: AuditLogEvent.BotAdd});
    invitedBy = logs.entries.find(entry => entry.target?.id === guild.client.user?.id)?.executor;
  } catch {}

  if (!invitedBy) {
    console.warn(`Could not find user who invited Muse to ${guild.name} from the audit logs.`);
  }

  return invitedBy;
}

export async function createGuildSettings(guild: Guild, invitedBy: User | null | undefined): Promise<Prisma.Prisma__SettingClient<Setting>> {
  return prisma.setting.upsert({
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
}

export default async (guild: Guild): Promise<void> => {
  const invitedBy = await getInvitedByUser(guild);

  await createGuildSettings(guild, invitedBy);

  const config = container.get<Config>(TYPES.Config);

  // Setup slash commands
  if (!config.REGISTER_COMMANDS_ON_BOT) {
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '10'}).setToken(config.DISCORD_TOKEN);

    await registerCommandsOnGuild({
      rest,
      applicationId: client.user!.id,
      guildId: guild.id,
      commands: container.getAll<Command>(TYPES.Command).map(command => command.slashCommand),
    });
  }

  if (invitedBy) {
    await invitedBy.send('👋 Hi! You just invited me to a server. I can\'t be used by your server members until you complete setup by running /config set-role in your server.');
  } else {
    const owner = await guild.fetchOwner();
    await owner.send('👋 Hi! Someone (probably you) just invited me to a server you own. I can\'t be used by your server members until you complete setup by running /config set-role in your server.');
  }
};
