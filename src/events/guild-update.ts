import {Guild} from 'discord.js';
import updatePermissionsForGuild from '../utils/update-permissions-for-guild.js';

const handleGuildUpdate = async (oldGuild: Guild, newGuild: Guild) => {
  if (oldGuild.ownerId !== newGuild.ownerId) {
    await updatePermissionsForGuild(newGuild);
  }
};

export default handleGuildUpdate;
