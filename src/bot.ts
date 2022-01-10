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
  private readonly env: string;
  private readonly commandsByName!: Collection<string, Command>;
  private readonly commandsByButtonId!: Collection<string, Command>;

  constructor(@inject(TYPES.Client) client: Client, @inject(TYPES.Config) config: Config) {
    this.client = client;
    this.token = config.DISCORD_TOKEN;
    this.env = config.NODE_ENV;
    this.commandsByName = new Collection();
    this.commandsByButtonId = new Collection();
  }

  public async listen(): Promise<void> {
    // Log environment
    console.log(`Starting environment: ${this.env}\n`);

    // Load in commands
    container.getAll<Command>(TYPES.Command).forEach(command => {
      // TODO: remove !
      if (command.slashCommand?.name) {
        this.commandsByName.set(command.slashCommand.name, command);
      }

      if (command.handledButtonIds) {
        command.handledButtonIds.forEach(id => this.commandsByButtonId.set(id, command));
      }
    });

    // Register event handlers
    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isCommand()) {
        return;
      }

      const command = this.commandsByName.get(interaction.commandName);

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

        // This can fail if the message was deleted, and we don't want to crash the whole bot
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply(errorMsg('something went wrong'));
          } else {
            await interaction.reply({content: errorMsg(error as Error), ephemeral: true});
          }
        } catch {}
      }
    });

    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isButton()) {
        return;
      }

      const command = this.commandsByButtonId.get(interaction.customId);

      if (!command) {
        return;
      }

      try {
        if (command.handleButtonInteraction) {
          await command.handleButtonInteraction(interaction);
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

    this.client.once('ready', async () => {
      debug(generateDependencyReport());

      spinner.text = '📡 Updating commands in all guilds...';

      // Update commands
      const rest = new REST({version: '9'}).setToken(this.token);

      switch (this.env) {
        case 'production':
          // If production, set commands bot-wide
          await rest.put(
            Routes.applicationCommands(this.client.user!.id),
            {body: this.commandsByName.map(command => command.slashCommand ? command.slashCommand.toJSON() : null)},
          );
          break;
        default:
          // If development, set commands guild-wide
          this.client.guilds.cache.each(async guild => {
            await rest.put(
              Routes.applicationGuildCommands(this.client.user!.id, guild.id),
              {body: this.commandsByName.map(command => command.slashCommand ? command.slashCommand.toJSON() : null)},
            );
          });
      }
      
      spinner.succeed(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.client.user?.id ?? ''}&scope=bot%20applications.commands&permissions=2184236096`);
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    this.client.on('guildCreate', handleGuildCreate);
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate);

    await this.client.login(this.token);
  }
}
