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
import {LocalizedError, t} from './i18n/index.js';
import {isUserInVoice} from './utils/channels.js';
import Config from './services/config.js';
import {generateDependencyReport} from '@discordjs/voice';
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v10';
import registerCommandsOnGuild from './utils/register-commands-on-guild.js';
import {BOT_INVITE_PERMISSIONS} from './utils/constants.js';
import type SessionPlayer from './services/session-player.js';
import {SESSION_BUTTON_PREFIX} from './utils/build-session-message.js';

const sanitizeErrorDetail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/(["']?\b(?:api[-_]?key|key|token|authorization|cookie)["']?\s*[:=]\s*)(?:["'][^"']*["']|Bearer\s+[^,;\s]+|[^,;\s}\]]+)/gi, '$1[redacted]')
    .replace(/\b(authorization|cookie)\s*[:=]\s*[^\r\n]*/gi, '$1: [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
};

const sanitizeErrorForLog = (error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const detail = sanitizeErrorDetail(error);

  return `${name}: ${detail || 'unknown error'}`;
};

@injectable()
export default class {
  private readonly client: Client;
  private readonly config: Config;
  private readonly shouldRegisterCommandsOnBot: boolean;
  private readonly commandsByName!: Collection<string, Command>;
  private readonly commandsByButtonId!: Collection<string, Command>;

  constructor(@inject(TYPES.Client) client: Client, @inject(TYPES.Config) config: Config) {
    this.client = client;
    this.config = config;
    this.shouldRegisterCommandsOnBot = config.REGISTER_COMMANDS_ON_BOT;
    this.commandsByName = new Collection();
    this.commandsByButtonId = new Collection();
  }

  public async register(): Promise<void> {
    // Close persisted sessions before login, before Discord can deliver /play.
    await container.get<SessionPlayer>(TYPES.Services.SessionPlayer).prepareRecovery();
    // Load in commands
    for (const command of container.getAll<Command>(TYPES.Command)) {
      // Make sure we can serialize to JSON without errors
      try {
        command.slashCommand.toJSON();
      } catch (error) {
        console.error(error);
        throw new Error(`Could not serialize /${command.slashCommand.name ?? ''} to JSON`);
      }

      if (command.slashCommand.name) {
        this.commandsByName.set(command.slashCommand.name, command);
      }

      if (command.handledButtonIds) {
        for (const buttonId of command.handledButtonIds) {
          this.commandsByButtonId.set(buttonId, command);
        }
      }
    }

    this.commandsByName.get('help')?.setCommands?.([...this.commandsByName.values()]);

    // Register event handlers
    // eslint-disable-next-line complexity
    this.client.on('interactionCreate', async interaction => {
      try {
        if (interaction.isCommand()) {
          const command = this.commandsByName.get(interaction.commandName);

          if (!command || !interaction.isChatInputCommand()) {
            return;
          }

          if (!interaction.guild) {
            await interaction.reply(errorMsg(t(interaction.locale, 'error.guildOnly'), interaction.locale));
            return;
          }

          const requiresVC = command.requiresVC instanceof Function ? command.requiresVC(interaction) : command.requiresVC;
          if (requiresVC && interaction.member && !isUserInVoice(interaction.guild, interaction.member.user as User)) {
            await interaction.reply({content: errorMsg(t(interaction.locale, 'error.voiceRequired'), interaction.locale), ephemeral: true});
            return;
          }

          if (command.execute) {
            await command.execute(interaction);
          }
        } else if (interaction.isButton()) {
          if (interaction.customId.startsWith(SESSION_BUTTON_PREFIX)) {
            await container.get<SessionPlayer>(TYPES.Services.SessionPlayer).handleButton(interaction);
            return;
          }

          const command = this.commandsByButtonId.get(interaction.customId);

          if (!command) {
            return;
          }

          if (command.handleButtonInteraction) {
            await command.handleButtonInteraction(interaction);
          }
        } else if (interaction.isAutocomplete()) {
          const command = this.commandsByName.get(interaction.commandName);

          if (!command) {
            return;
          }

          if (command.handleAutocompleteInteraction) {
            await command.handleAutocompleteInteraction(interaction);
          }
        }
      } catch (error: unknown) {
        const sanitizedError = sanitizeErrorForLog(error);
        debug(sanitizedError);
        const interactionName = interaction.isCommand() || interaction.isAutocomplete()
          ? `/${interaction.commandName}`
          : interaction.isButton()
            ? `button:${interaction.customId}`
            : interaction.type.toString();
        console.error(`Discord interaction failed (${interactionName}, guild=${interaction.guildId ?? 'dm'}, channel=${interaction.channelId ?? 'unknown'}, user=${interaction.user.id}): ${sanitizedError}`);
        const userSafeError = new Error(sanitizeErrorDetail(error instanceof LocalizedError ? error.localize(interaction.locale) : error));

        // This can fail if the message was deleted, and we don't want to crash the whole bot
        try {
          if ((interaction.isCommand() || interaction.isButton()) && (interaction.replied || interaction.deferred)) {
            await interaction.editReply(errorMsg(userSafeError, interaction.locale));
          } else if (interaction.isCommand() || interaction.isButton()) {
            await interaction.reply({content: errorMsg(userSafeError, interaction.locale), ephemeral: true});
          }
        } catch {}
      }
    });

    const spinner = ora('📡 connecting to Discord...').start();

    const presence = {
      activities: [{
        name: this.config.BOT_ACTIVITY,
        type: this.config.BOT_ACTIVITY_TYPE,
        url: this.config.BOT_ACTIVITY_URL === '' ? undefined : this.config.BOT_ACTIVITY_URL,
      }],
      status: this.config.BOT_STATUS,
    };

    this.client.once('ready', async () => {
      debug(generateDependencyReport());

      try {
        await container.get<SessionPlayer>(TYPES.Services.SessionPlayer).recover(this.client);
      } catch (error: unknown) {
        console.error(`Listening-session recovery failed: ${sanitizeErrorForLog(error)}`);
        this.client.destroy();
        return;
      }

      // Update commands
      const rest = new REST({version: '10'}).setToken(this.config.DISCORD_TOKEN);
      if (this.shouldRegisterCommandsOnBot) {
        spinner.text = '📡 updating commands on bot...';
        await rest.put(
          Routes.applicationCommands(this.client.user!.id),
          {body: this.commandsByName.map(command => command.slashCommand.toJSON())},
        );
      } else {
        spinner.text = '📡 updating commands in all guilds...';

        await Promise.all([
          ...this.client.guilds.cache.map(async guild => {
            await registerCommandsOnGuild({
              rest,
              guildId: guild.id,
              applicationId: this.client.user!.id,
              commands: this.commandsByName.map(c => c.slashCommand),
            });
          }),
          // Remove commands registered on bot (if they exist)
          rest.put(Routes.applicationCommands(this.client.user!.id), {body: []}),
        ],
        );
      }

      this.client.user!.setPresence(presence);

      spinner.succeed(`Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.client.user?.id ?? ''}&scope=bot%20applications.commands&permissions=${BOT_INVITE_PERMISSIONS}`);
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    this.client.on('guildCreate', handleGuildCreate);
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate);
    // Discord reuses login presence when a reconnect requires a new Identify.
    this.client.options.presence = presence;
    await this.client.login();
  }
}
