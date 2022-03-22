import {ApplicationCommandPermissionData, Guild} from 'discord.js';
import {prisma} from './db.js';

const COMMANDS_TO_LIMIT_TO_GUILD_OWNER = ['config'];

const updatePermissionsForGuild = async (guild: Guild) => {
  const settings = await prisma.setting.findUnique({
    where: {
      guildId: guild.id,
    },
  });

  if (!settings) {
    throw new Error('Ich kann die Servereinstellungen nicht finden!');
  }

  const permissions: ApplicationCommandPermissionData[] = [
    {
      id: guild.ownerId,
      type: 'USER',
      permission: true,
    },
    {
      id: guild.roles.everyone.id,
      type: 'ROLE',
      permission: false,
    },
  ];

  if (settings.invitedByUserId) {
    permissions.push({
      id: settings.invitedByUserId,
      type: 'USER',
      permission: true,
    });
  }

  const commands = await guild.commands.fetch();

  await guild.commands.permissions.set({fullPermissions: commands.map(command => ({
    id: command.id,
    permissions: COMMANDS_TO_LIMIT_TO_GUILD_OWNER.includes(command.name) ? permissions : [
      ...permissions,
      ...(settings.roleId ? [{
        id: settings.roleId,
        type: 'ROLE' as const,
        permission: true,
      }] : []),
    ],
  }))});
};

export default updatePermissionsForGuild;
