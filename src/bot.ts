import {Client, Message, Collection} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from './types.js';
import {Settings, Shortcut} from './models/index.js';
import container from './inversify.config.js';
import Command from './commands/index.js';
import debug from './utils/debug.js';
import NaturalLanguage from './services/natural-language-commands.js';
import handleGuildCreate from './events/guild-create.js';
import handleVoiceStateUpdate from './events/voice-state-update.js';
import errorMsg from './utils/error-msg.js';
import {isUserInVoice} from './utils/channels.js';
import Config from './services/config.js';

@injectable()
export default class {
  private readonly client: Client;
  private readonly naturalLanguage: NaturalLanguage;
  private readonly token: string;
  private readonly commands!: Collection<string, Command>;

  constructor(@inject(TYPES.Client) client: Client, @inject(TYPES.Services.NaturalLanguage) naturalLanguage: NaturalLanguage, @inject(TYPES.Config) config: Config) {
    this.client = client;
    this.naturalLanguage = naturalLanguage;
    this.token = config.DISCORD_TOKEN;
    this.commands = new Collection();
  }

  public async listen(): Promise<string> {
    // Load in commands
    container.getAll<Command>(TYPES.Command).forEach(command => {
      const commandNames = [command.name, ...command.aliases];

      commandNames.forEach(commandName => this.commands.set(commandName, command));
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

      const {prefix, channel} = settings;

      if (!msg.content.startsWith(prefix) && !msg.author.bot && msg.channel.id === channel && await this.naturalLanguage.execute(msg)) {
        // Natural language command handled message
        return;
      }

      if (!msg.content.startsWith(prefix) || msg.channel.id !== channel) {
        return;
      }

      let args = msg.content.slice(prefix.length).split(/ +/);
      const command = args.shift()!.toLowerCase();

      // Get possible shortcut
      const shortcut = await Shortcut.findOne({where: {guildId: msg.guild.id, shortcut: command}});

      let handler: Command;

      if (this.commands.has(command)) {
        handler = this.commands.get(command)!;
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
        if (handler.requiresVC && !isUserInVoice(msg.guild, msg.author)) {
          await msg.channel.send(errorMsg('gotta be in a voice channel'));
          return;
        }

        await handler.execute(msg, args);
      } catch (error: unknown) {
        debug(error);
        await msg.channel.send(errorMsg((error as Error).message.toLowerCase()));
      }
    });

    this.client.on('ready', async () => {
      console.log(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.client.user?.id ?? ''}&scope=bot&permissions=36752448`);
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    // Register event handlers
    this.client.on('guildCreate', handleGuildCreate);
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate);

    return this.client.login(this.token);
  }
}
