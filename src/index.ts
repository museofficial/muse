import fs from 'fs';
import path from 'path';
import makeDir from 'make-dir';
import Discord from 'discord.js';
import {DISCORD_TOKEN, DISCORD_CLIENT_ID, DATA_DIR, CACHE_DIR} from './utils/config';
import {Settings} from './models';
import {sequelize} from './utils/db';
import {CommandHandler} from './interfaces';
import handleGuildCreate from './events/guild-create';

const client = new Discord.Client();
const commands = new Discord.Collection();

// Load in commands
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`).default;

  commands.set(command.name, command);
}

// Generic message handler
client.on('message', async (msg: Discord.Message) => {
  // Get guild settings
  const settings = await Settings.findByPk(msg.guild!.id);

  if (!settings) {
    // Got into a bad state, send owner welcome message
    return client.emit('guildCreate', msg.guild);
  }

  const {prefix, channel} = settings;

  if (!msg.content.startsWith(prefix) || msg.author.bot || msg.channel.id !== channel) {
    return;
  }

  const args = msg.content.slice(prefix.length).split(/ +/);
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
  await makeDir(CACHE_DIR);

  await sequelize.sync({});

  console.log(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&scope=bot`);
});

client.on('guildCreate', handleGuildCreate);

client.login(DISCORD_TOKEN);
