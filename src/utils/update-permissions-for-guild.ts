import {ApplicationCommandPermissionData, ApplicationCommandPermissionType, Client, Guild} from 'discord.js';
import {prisma} from './db.js';
import {REST} from '@discordjs/rest';
import container from '../inversify.config';
import {TYPES} from '../types';
import Token from '../managers/token';
import {Routes} from 'discord-api-types/v10';
import {createGuildSettings, getInvitedByUser} from '../events/guild-create';
import {Setting} from '.prisma/client';

const COMMANDS_TO_LIMIT_TO_GUILD_OWNER = ['config'];

const updatePermissionsForGuild = async (guild: Guild) => {
  const client = container.get<Client>(TYPES.Client);
  const token = container.get<Token>(TYPES.Managers.Token).getBearerToken();
  const rest = new REST({version: '10', authPrefix: 'Bearer', retries: 10}).setToken(token);
  let settings: Setting | null;

  settings = await prisma.setting.findUnique({
    where: {
      guildId: guild.id,
    },
  });
  if (!settings) {
    console.warn('Settings for guild not found, creating new settings. Permission will be reset to default.');
    const invitedBy = await getInvitedByUser(guild);
    settings = await createGuildSettings(guild, invitedBy);
  }

  const permissions: ApplicationCommandPermissionData[] = [
    {
      id: guild.ownerId,
      type: ApplicationCommandPermissionType.User,
      permission: true,
    },
    {
      id: guild.roles.everyone.id,
      type: ApplicationCommandPermissionType.Role,
      permission: false,
    },
  ];

  if (settings.invitedByUserId) {
    permissions.push({
      id: settings.invitedByUserId,
      type: ApplicationCommandPermissionType.User,
      permission: true,
    });
  }

  const commands = await guild.commands.fetch();
  await Promise.all(commands.map(async command => {
    await rest.put(Routes.applicationCommandPermissions(client.user!.id, guild.id, command.id), {
      body: {
        permissions: COMMANDS_TO_LIMIT_TO_GUILD_OWNER.includes(command.name) ? permissions : [
          ...permissions,
          ...(settings?.roleId ? [{
            id: settings.roleId,
            type: ApplicationCommandPermissionType.Role as const,
            permission: true,
          }] : []),
        ],
      },
    });
  }));
};

export default updatePermissionsForGuild;
