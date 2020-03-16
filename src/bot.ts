import makeDir from 'make-dir';
import {Client, Message, Collection} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from './types';
import {Settings} from './models';
import {sequelize} from './utils/db';
import handleGuildCreate from './events/guild-create';
import container from './inversify.config';
import Command from './commands';

@injectable()
export default class {
  private readonly client: Client;
  private readonly token: string;
  private readonly clientId: string;
  private readonly dataDir: string;
  private readonly cacheDir: string;
  private readonly commands!: Collection<string, Command>;

  constructor(@inject(TYPES.Client) client: Client, @inject(TYPES.Config.DISCORD_TOKEN) token: string, @inject(TYPES.Config.DISCORD_CLIENT_ID) clientId: string, @inject(TYPES.Config.DATA_DIR) dataDir: string, @inject(TYPES.Config.CACHE_DIR) cacheDir: string) {
    this.client = client;
    this.token = token;
    this.clientId = clientId;
    this.dataDir = dataDir;
    this.cacheDir = cacheDir;
    this.commands = new Collection();
  }

  public async listen(): Promise<string> {
    // Load in commands
    container.getAll<Command>(TYPES.Command).forEach(command => {
      this.commands.set(command.name, command);
    });

    this.client.on('message', async (msg: Message) => {
      // Get guild settings
      if (!msg.guild) {
        return;
      }

      const settings = await Settings.findByPk(msg.guild.id);

      if (!settings) {
        // Got into a bad state, send owner welcome message
        return this.client.emit('guildCreate', msg.guild);
      }

      if (msg.content.startsWith('say') && msg.content.endsWith('muse')) {
        const res = msg.content.slice(3, msg.content.indexOf('muse')).trim();

        await msg.channel.send(res);
        return;
      }

      const {prefix, channel} = settings;

      if (!msg.content.startsWith(prefix) || msg.author.bot || msg.channel.id !== channel) {
        return;
      }

      const args = msg.content.slice(prefix.length).split(/ +/);
      const command = args.shift()!.toLowerCase();

      if (!this.commands.has(command)) {
        return;
      }

      try {
        const handler = this.commands.get(command);

        handler!.execute(msg, args);
      } catch (error) {
        console.error(error);
        msg.reply('there was an error trying to execute that command!');
      }
    });

    this.client.on('ready', async () => {
      // Create directory if necessary
      await makeDir(this.dataDir);
      await makeDir(this.cacheDir);

      await sequelize.sync({});

      console.log(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.clientId}&scope=bot`);
    });

    // Register event handlers
    this.client.on('guildCreate', handleGuildCreate);

    return this.client.login(this.token);
  }
}
