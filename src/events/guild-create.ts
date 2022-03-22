import {Guild, Client} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v9';
import updatePermissionsForGuild from '../utils/update-permissions-for-guild.js';

export default async (guild: Guild): Promise<void> => {
  let invitedBy;
  try {
    const logs = await guild.fetchAuditLogs({type: 'BOT_ADD'});
    invitedBy = logs.entries.find(entry => entry.target?.id === guild.client.user?.id)?.executor;
  } catch {}

  if (!invitedBy) {
    console.warn(`Ich kann den User nicht finden der mich zu ${guild.name} hinzugefügt hat!`);
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
    const token = container.get<Config>(TYPES.Config).DISCORD_TOKEN;
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '9'}).setToken(token);

    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, guild.id),
      {body: container.getAll<Command>(TYPES.Command).map(command => command.slashCommand.toJSON())},
    );
  }

  await updatePermissionsForGuild(guild);

  if (invitedBy) {
    await invitedBy.send('👋 Hi! Du hast mich in diesen Server gebracht! Ich kann aber erst richtig genutzt werden, wenn du /config set-role in dem Server benutzt und richtig einstellst!');
  } else {
    const owner = await guild.fetchOwner();
    await owner.send('👋 Hi! Irgendwer (womöglich du) hat mich in den Server eingeladen den du besitzt! Ich kann aber erst richtig genutzt werden, wenn du /config set-role in dem Server benutzt und richtig einstellst!');
  }
};
