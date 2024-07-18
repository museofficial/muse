import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v10';
import Command from '../commands/index.js';

interface RegisterCommandsOnGuildOptions {
  rest: REST;
  applicationId: string;
  guildId: string;
  commands: Array<Command['slashCommand']>;
}

const registerCommandsOnGuild = async ({rest, applicationId, guildId, commands}: RegisterCommandsOnGuildOptions) => {
  await rest.put(
    Routes.applicationGuildCommands(applicationId, guildId),
    {body: commands.map(command => command.toJSON())},
  );
};

export default registerCommandsOnGuild;
