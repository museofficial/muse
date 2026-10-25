import {ChannelType, PermissionFlagsBits, type ButtonInteraction, type Client, type GuildTextBasedChannel, type Message} from 'discord.js';
import {inject, injectable} from 'inversify';
import {Routes} from 'discord-api-types/v10';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import type Player from './player.js';
import {STATUS} from './player-types.js';
import type {ListeningSessionRecord} from './listening-session.js';
import SessionHistoryStore from './session-history-store.js';
import SessionHistoryPublisher from './session-history-publisher.js';
import canUsePlaybackCommand from '../utils/can-use-playback-command.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildHistoryMessages, buildMoreMessage, buildQueueMessage, buildSessionMessage, buildSessionMessages, SESSION_BUTTON_PREFIX} from '../utils/build-session-message.js';

const isMissingMessage = (error: unknown): boolean => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 10008);
const playbackCommands: Record<string, string> = {
  previous: 'unskip', next: 'next', pause: 'pause', resume: 'resume', backward: 'seek', forward: 'fseek', shuffle: 'shuffle', stop: 'stop',
};

@injectable()
export default class SessionPlayer {
  private readonly publications = new Map<string, Promise<unknown>>();
  private readonly actions = new Map<string, Promise<unknown>>();
  private interruptedSessions: ListeningSessionRecord[] = [];
  private readonly historyPublisher: SessionHistoryPublisher;

  constructor(
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager,
    @inject(TYPES.Services.SessionHistoryStore) private readonly store: SessionHistoryStore,
  ) {
    this.historyPublisher = new SessionHistoryPublisher(store);
  }

  public async ensureMessage(player: Player, channel: GuildTextBasedChannel, expectedSessionId?: string): Promise<string> {
    const controller = player.listeningSession;
    if (expectedSessionId && controller?.snapshot()?.id !== expectedSessionId) {
      throw new Error('This listening session has ended.');
    }

    // Save the origin before publication can fail. A later recovery request in
    // another channel must not move this session's private listening history.
    controller?.setChannel(channel.id);
    const captured = controller?.snapshot();
    if (!controller || !captured) {
      throw new Error('No listening session is available.');
    }

    // Pin this request before waiting for another publication or database write.
    // A Stop or new session must not erase the captured session's first recap.
    return this.serialize(this.publications, player.guildId, async () => {
      const {defaultQueuePageSize} = await getGuildSettings(player.guildId);
      await controller.flush();
      let session = await this.capturedSession(player, captured.id);
      const originalChannelId = session.channelId ?? captured.channelId;
      const originalChannel = !originalChannelId || originalChannelId === channel.id
        ? channel : await channel.client.channels.fetch(originalChannelId);
      if (!originalChannel?.isTextBased() || !('guild' in originalChannel) || originalChannel.guild.id !== player.guildId) {
        throw new Error('The player channel is no longer accessible.');
      }

      let card: Message | undefined;
      if (session.messageId) {
        try {
          card = await originalChannel.messages.fetch({message: session.messageId, force: true});
        } catch (error) {
          if (!isMissingMessage(error)) {
            throw error;
          }
        }
      }

      session = await this.capturedSession(player, captured.id);
      if (!card) {
        card = await originalChannel.send(buildSessionMessage(session, session.endedAt ? undefined : player, defaultQueuePageSize));
        // Persist a late card on its captured record, never on a newer session.
        if (controller.snapshot()?.id !== captured.id) {
          await this.archivePublication(player, captured.id, card, originalChannel);
          return `https://discord.com/channels/${player.guildId}/${card.channelId}/${card.id}`;
        }

        try {
          await controller.setMessage(card.channelId, card.id);
        } catch (error) {
          await card.delete().catch(() => undefined);
          throw error;
        }
      }

      const bound = await this.capturedSession(player, captured.id);
      if (bound.endedAt) {
        await this.publishMessages(card, originalChannel, bound);
        return `https://discord.com/channels/${player.guildId}/${card.channelId}/${card.id}`;
      }

      const published = card;
      player.setPlayingMessageUpdater(async () => this.serialize(this.publications, player.guildId, async () => {
        await controller.flush();
        const current = controller.snapshot();
        const snapshot = current?.id === captured.id ? current : await this.capturedSession(player, captured.id);
        if (snapshot.messageId !== published.id || snapshot.channelId !== published.channelId) {
          return;
        }

        await this.publishMessages(published, originalChannel, snapshot, {
          player: current?.id === captured.id ? player : undefined, queuePageSize: defaultQueuePageSize,
        });
      }), card.id, {keepAfterFinish: true, retryOnError: true});
      await this.historyPublisher.publish(originalChannel, bound, buildSessionMessages(bound, player, defaultQueuePageSize).slice(1), {force: true});
      player.refreshPlayingMessage();
      return `https://discord.com/channels/${player.guildId}/${card.channelId}/${card.id}`;
    });
  }

  /** Run before login so a newly started session cannot be marked interrupted. */
  public async prepareRecovery(): Promise<void> {
    this.interruptedSessions = await this.store.interruptOpenSessions();
  }

  public async recover(client: Client): Promise<void> {
    const interrupted = this.interruptedSessions;
    this.interruptedSessions = [];
    await Promise.all(interrupted.map(async session => this.serialize(this.publications, session.guildId, async () => {
      if (!session.channelId) {
        return;
      }

      try {
        const channel = await client.channels.fetch(session.channelId);
        if (!channel?.isTextBased() || !('guild' in channel) || channel.guild.id !== session.guildId) {
          throw new Error('The original player channel is no longer accessible.');
        }

        let card: Message | undefined;
        if (session.messageId) {
          try {
            card = await channel.messages.fetch({message: session.messageId, force: true});
          } catch (error) {
            if (!isMissingMessage(error)) {
              throw error;
            }
          }
        }

        if (!card) {
          // A crash before publication or a deleted card must not leave saved
          // history without a reachable entry point after restart.
          const replacement = await channel.send(buildSessionMessage(session));
          try {
            await this.store.save({...session, channelId: channel.id, messageId: replacement.id});
            card = replacement;
          } catch (error) {
            await replacement.delete().catch(() => undefined);
            throw error;
          }
        }

        // Acknowledge recovery only after every public continuation is saved.
        await this.publishMessages(card, channel, session);
      } catch {
        // Never move saved history into a different channel when its original
        // channel cannot be read or written.
        console.error(`Could not refresh archived listening-session card ${session.id}.`);
      }
    })));
  }

  public async handleButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.customId.startsWith(SESSION_BUTTON_PREFIX)) {
      return;
    }

    // Start every acknowledgement immediately, but reserve transport order
    // before any REST or database wait can let a later click overtake this one.
    const acknowledgement = interaction.deferReply({ephemeral: true}).then(
      () => ({ok: true as const}),
      (error: unknown) => ({ok: false as const, error}),
    );
    const run = async () => {
      const result = await acknowledgement;
      if (!result.ok) {
        throw result.error;
      }

      await this.handleAcknowledgedButton(interaction);
    };

    const action = interaction.customId.slice(SESSION_BUTTON_PREFIX.length).split(':')[1];
    if (interaction.guild && Object.keys(playbackCommands).includes(action)) {
      await this.serialize(this.actions, interaction.guild.id, run);
    } else {
      await run();
    }
  }

  private async handleAcknowledgedButton(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.slice(SESSION_BUTTON_PREFIX.length).split(':');
    const [sessionId, action, rawPage] = parts;
    const page = Number(rawPage);
    if (parts.length !== 3 || !/^[\da-f-]{36}$/i.test(sessionId) || !Number.isSafeInteger(page) || page < 0
      || !interaction.guild || !['history', 'queue', 'more', ...Object.keys(playbackCommands)].includes(action)) {
      await interaction.editReply('This player control is no longer available.');
      return;
    }

    const existingPlayer = this.playerManager.getExisting(interaction.guild.id);
    await existingPlayer?.listeningSession?.flush();
    const session = await this.store.load(sessionId, interaction.guild.id);
    if (!session || !await this.canReadSession(interaction, session)) {
      await interaction.editReply('This listening session is not available in this channel.');
      return;
    }

    if (action === 'history') {
      // Old deployed buttons remain readable, but never require pagination.
      const [first, ...rest] = buildHistoryMessages(session);
      await interaction.editReply(first);
      for (const payload of rest) {
        // eslint-disable-next-line no-await-in-loop
        await interaction.followUp({...payload, ephemeral: true});
      }

      return;
    }

    const player = this.currentPlayer(session);
    if (!player) {
      await interaction.editReply('This listening session has ended. Its history is still available.');
      return;
    }

    if (action === 'queue' || action === 'more') {
      await interaction.editReply(action === 'queue' ? buildQueueMessage(session, player, page) : buildMoreMessage(session, player));
      return;
    }

    await this.handleTransportButton(interaction, session, action);
  }

  private async handleTransportButton(interaction: ButtonInteraction, session: ListeningSessionRecord, action: string): Promise<void> {
    const {guild} = interaction;
    const active = this.currentPlayer(session);
    if (!guild || !active || !session.messageId || !session.channelId) {
      await interaction.editReply('This listening session has ended.');
      return;
    }

    const channel = await guild.channels.fetch(session.channelId, {force: true});
    if (!channel?.isTextBased()) {
      await interaction.editReply('The player channel is no longer accessible.');
      return;
    }

    let card: Message;
    try {
      card = await channel.messages.fetch({message: session.messageId, force: true});
    } catch (error) {
      if (!isMissingMessage(error)) {
        throw error;
      }

      if (this.currentPlayer(session) !== active) {
        await interaction.editReply('This listening session has ended.');
        return;
      }

      await this.ensureMessage(active, channel, session.id);
      await interaction.editReply('The player card was replaced. Use its new controls.');
      return;
    }

    const canControl = () => this.currentPlayer(session) === active
      && guild.members.cache.get(interaction.user.id)?.voice.channelId === active.voiceConnection?.joinConfig.channelId
      && Boolean(active.voiceConnection?.joinConfig.channelId);
    const command = playbackCommands[action];
    if (!canControl() || !await canUsePlaybackCommand(card, interaction.user.id, command) || !canControl()) {
      await interaction.editReply('Join the bot\'s voice channel and check your permission to use this command.');
      return;
    }

    await this.applyAction(active, action);
    active.refreshPlayingMessage();
    await active.listeningSession?.flush();
    // The shared card shows the result. Keep failures private, but leave no
    // extra confirmation message after a successful control action.
    await interaction.deleteReply();
  }

  private currentPlayer(session: ListeningSessionRecord): Player | undefined {
    const player = this.playerManager.getExisting(session.guildId);
    const current = player?.listeningSession?.snapshot();
    return current?.id === session.id && !current.endedAt ? player : undefined;
  }

  private async capturedSession(player: Player, sessionId: string): Promise<ListeningSessionRecord> {
    const current = player.listeningSession?.snapshot();
    if (current?.id === sessionId) {
      return current;
    }

    await player.listeningSession?.flush();
    const saved = await this.store.load(sessionId, player.guildId);
    if (!saved) {
      throw new Error('The listening-session history is not available.');
    }

    return saved;
  }

  private async archivePublication(player: Player, sessionId: string, card: Message, channel: GuildTextBasedChannel): Promise<void> {
    try {
      await player.listeningSession?.flush();
      const completed = await this.store.load(sessionId, player.guildId);
      if (!completed?.endedAt) {
        throw new Error('The completed listening-session history is not available.');
      }

      // The controller now owns a different session. Bind only the completed
      // record so this late card's history link still works after a restart.
      const bound = {...completed, channelId: card.channelId, messageId: card.id};
      await this.store.save(bound);
    } catch (error) {
      await card.delete().catch(() => undefined);
      throw error;
    }

    const bound = await this.store.load(sessionId, player.guildId);
    if (bound) {
      await this.publishMessages(card, channel, bound);
    }
  }

  private async publishMessages(card: Message, channel: GuildTextBasedChannel, session: ListeningSessionRecord, {player, queuePageSize}: {player?: Player; queuePageSize?: number} = {}): Promise<void> {
    const [first, ...history] = buildSessionMessages(session, player, queuePageSize);
    await card.edit(first);
    await this.historyPublisher.publish(channel, {...session, channelId: card.channelId, messageId: card.id}, history, {force: Boolean(session.endedAt)});
    if (session.endedAt) {
      await this.store.markRecovered(session.id);
      this.historyPublisher.forget(session.id);
    }
  }

  private async canReadSession(interaction: ButtonInteraction, session: ListeningSessionRecord): Promise<boolean> {
    if (!interaction.guild || !session.channelId || interaction.channelId !== session.channelId) {
      return false;
    }

    try {
      const [member, channel] = await Promise.all([
        interaction.guild.members.fetch({user: interaction.user.id, force: true}),
        interaction.guild.channels.fetch(session.channelId, {force: true}),
        interaction.guild.roles.fetch(),
      ]);
      if (!channel?.isTextBased()) {
        return false;
      }

      if (channel.isThread() && (!channel.parentId || !await interaction.guild.channels.fetch(channel.parentId, {force: true}))) {
        return false;
      }

      if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
        return false;
      }

      if (channel.type === ChannelType.PrivateThread && !channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads)) {
        // The pinned ThreadMemberManager may return the entire member list
        // for an uncached user. Query that exact user afresh and check its ID.
        const membership = await channel.client.rest.get(Routes.threadMembers(channel.id, interaction.user.id));
        if (!membership || typeof membership !== 'object' || !('user_id' in membership) || membership.user_id !== interaction.user.id) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  private async applyAction(player: Player, action: string): Promise<void> {
    if (action === 'previous' && player.canGoBack()) {
      await player.back();
    } else if (action === 'next' && player.canGoForward(1)) {
      await player.forward(1);
    } else if (action === 'pause' && player.status === STATUS.PLAYING) {
      player.pause();
    } else if (action === 'resume' && player.status === STATUS.PAUSED && player.getCurrent()) {
      await player.play();
    } else if (action === 'stop') {
      player.stop();
    } else if (action === 'shuffle') {
      player.shuffle();
    } else if (action === 'backward' || action === 'forward') {
      const track = player.getCurrent();
      if (track && !track.isLive) {
        const target = Math.max(0, Math.min(track.length, player.getPosition() + (action === 'forward' ? 10 : -10)));
        await player.seek(target, {preservePausedState: true});
      }
    }
  }

  private async serialize<T>(pending: Map<string, Promise<unknown>>, key: string, action: () => Promise<T>): Promise<T> {
    const task = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
    pending.set(key, task);
    try {
      return await task;
    } finally {
      if (pending.get(key) === task) {
        pending.delete(key);
      }
    }
  }
}
