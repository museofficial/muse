import {Client, Message, Collection} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from './types';
import {Settings, Shortcut} from './models';
import container from './inversify.config';
import Command from './commands';
import debug from './utils/debug';
import handleGuildCreate from './events/guild-create';
import handleVoiceStateUpdate from './events/voice-state-update';

@injectable()
export default class {
  private readonly client: Client;
  private readonly token: string;
  private readonly clientId: string;
  private readonly commands!: Collection<string, Command>;

  constructor(@inject(TYPES.Client) client: Client, @inject(TYPES.Config.DISCORD_TOKEN) token: string, @inject(TYPES.Config.DISCORD_CLIENT_ID) clientId: string) {
    this.client = client;
    this.token = token;
    this.clientId = clientId;
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

      let args = msg.content.slice(prefix.length).split(/ +/);
      const command = args.shift()!.toLowerCase();

      // Get possible shortcut
      const shortcut = await Shortcut.findOne({where: {guildId: msg.guild.id, shortcut: command}});

      let handler: Command;

      if (this.commands.has(command)) {
        handler = this.commands.get(command) as Command;
      } else if (shortcut) {
        const possibleHandler = this.commands.get(shortcut.command.split(' ')[0]);

        if (possibleHandler) {
          handler = possibleHandler;
          args = shortcut.command.split(/ +/).slice(1);
        } else {
          return;
        }
      } else {
        return;
      }

      try {
        handler.execute(msg, args);
      } catch (error) {
        console.error(error);
        msg.reply('there was an error trying to execute that command!');
      }
    });

    this.client.on('ready', async () => {
      console.log(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.clientId}&scope=bot`);
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    // Register event handlers
    this.client.on('guildCreate', handleGuildCreate);
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate);

    return this.client.login(this.token);
  }
}
