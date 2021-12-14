import {Client, Collection, User} from 'discord.js';
import {inject, injectable} from 'inversify';
import ora from 'ora';
import {TYPES} from './types.js';
import container from './inversify.config.js';
import Command from './commands/index.js';
import debug from './utils/debug.js';
import handleGuildCreate from './events/guild-create.js';
import handleVoiceStateUpdate from './events/voice-state-update.js';
import errorMsg from './utils/error-msg.js';
import {isUserInVoice} from './utils/channels.js';
import Config from './services/config.js';
import {generateDependencyReport} from '@discordjs/voice';
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v9';

@injectable()
export default class {
  private readonly client: Client;
  private readonly token: string;
  private readonly commands!: Collection<string, Command>;

  constructor(@inject(TYPES.Client) client: Client, @inject(TYPES.Config) config: Config) {
    this.client = client;
    this.token = config.DISCORD_TOKEN;
    this.commands = new Collection();
  }

  public async listen(): Promise<void> {
    // Load in commands
    container.getAll<Command>(TYPES.Command).forEach(command => {
      // TODO: remove !
      if (command.slashCommand?.name) {
        this.commands.set(command.slashCommand.name, command);
      }
    });

    // Register event handlers
    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isCommand()) {
        return;
      }

      const command = this.commands.get(interaction.commandName);

      if (!command) {
        return;
      }

      if (!interaction.guild) {
        await interaction.reply(errorMsg('you can\'t use this bot in a DM'));
        return;
      }

      try {
        if (command.requiresVC && !isUserInVoice(interaction.guild, interaction.member.user as User)) {
          await interaction.reply({content: errorMsg('gotta be in a voice channel'), ephemeral: true});
          return;
        }

        if (command.executeFromInteraction) {
          await command.executeFromInteraction(interaction);
        }
      } catch (error: unknown) {
        debug(error);

        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(errorMsg('something went wrong'));
        } else {
          await interaction.reply({content: errorMsg(error as Error), ephemeral: true});
        }
      }
    });

    const spinner = ora('📡 connecting to Discord...').start();

    this.client.once('ready', () => {
      debug(generateDependencyReport());

      spinner.succeed(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.client.user?.id ?? ''}&scope=bot&permissions=2184236096`);
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    this.client.on('guildCreate', handleGuildCreate);
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate);

    // Update commands
    await this.client.login(this.token);

    const rest = new REST({version: '9'}).setToken(this.token);

    await rest.put(
      Routes.applicationGuildCommands(this.client.user!.id, this.client.guilds.cache.first()!.id),
      // TODO: remove
      {body: this.commands.map(command => command.slashCommand ? command.slashCommand.toJSON() : null)},
    );
  }
}
