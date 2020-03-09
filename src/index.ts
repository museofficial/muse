import fs from 'fs';
import path from 'path';
import makeDir from 'make-dir';
import Discord from 'discord.js';
import {DISCORD_TOKEN, DISCORD_CLIENT_ID, DATA_DIR} from './utils/config';
import {sequelize} from './utils/db';
import {CommandHandler} from './interfaces';
import handleGuildCreate from './events/guild-create';

const PREFIX = '!';

const client = new Discord.Client();
const commands = new Discord.Collection();

// Load in commands
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`).default;

  commands.set(command.name, command);
}

// Generic message handler
client.on('message', (msg: Discord.Message) => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) {
    return;
  }

  const args = msg.content.slice(PREFIX.length).split(/ +/);
  const command = args.shift()!.toLowerCase();

  if (!commands.has(command)) {
    return;
  }

  try {
    const handler = commands.get(command) as CommandHandler;

    handler.execute(msg, args);
  } catch (error) {
    console.error(error);
    msg.reply('there was an error trying to execute that command!');
  }
});

client.on('ready', async () => {
  // Create directory if necessary
  await makeDir(DATA_DIR);

  await sequelize.sync({});

  console.log(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&scope=bot`);
});

client.on('guildCreate', handleGuildCreate);

client.login(DISCORD_TOKEN);
