import {ButtonStyle, EmbedBuilder, escapeMarkdown} from 'discord.js';
import type Player from '../services/player.js';
import {MediaSource, STATUS} from '../services/player-types.js';
import type {ListeningSessionEntry, ListeningSessionRecord} from '../services/listening-session.js';
import {buildQueueEmbed} from './build-embed.js';
import {truncate} from './string.js';

export const SESSION_BUTTON_PREFIX = 'muse-session:';
const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_MESSAGE_EMBED_TEXT = 6000;
const MAX_MESSAGE_EMBEDS = 10;
const CONTINUED_HISTORY_TITLE = 'Session history (continued)';

export const sessionButtonId = (sessionId: string, action: string, page = 0): string => `${SESSION_BUTTON_PREFIX}${sessionId}:${action}:${page}`;

type SessionButton = {type: 2; custom_id: string; label: string; style: 1 | 2 | 3 | 4; disabled: boolean};
type SessionRow = {type: 1; components: SessionButton[]};

const button = (session: ListeningSessionRecord, action: string, label: string, options: {page?: number; disabled?: boolean; style?: 1 | 2 | 3 | 4} = {}): SessionButton => ({
  type: 2,
  custom_id: sessionButtonId(session.id, action, options.page),
  label,
  style: options.style ?? ButtonStyle.Secondary,
  disabled: options.disabled ?? false,
});

const row = (...buttons: SessionButton[]): SessionRow => ({type: 1, components: buttons});

type Track = {title: string; url: string; source: string | MediaSource; offset: number};

/** Display URLs are bounded independently of the original playback source. */
const trackLink = (track: Track, titleLimit = 120): string => {
  const title = escapeMarkdown(truncate(track.title.replace(/[\r\n\t]/g, ' ').trim() || 'Untitled track', titleLimit));
  let {url} = track;
  if (track.source === 'Youtube' || track.source === MediaSource.Youtube) {
    if (/^[\w-]{11}$/.test(url)) {
      url = `https://www.youtube.com/watch?v=${url}${track.offset > 0 ? `&t=${Math.floor(track.offset)}` : ''}`;
    }
  }

  if (url.length > 300) {
    return title;
  }

  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return title;
    }

    const displayUrl = parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return displayUrl.length <= 300 ? `[${title}](${displayUrl})` : title;
  } catch {
    return title;
  }
};

const entryLine = (entry: ListeningSessionEntry, index: number): string => {
  const labels: Record<ListeningSessionEntry['status'], string> = {
    playing: 'Playing', completed: 'Played', skipped: 'Skipped', stopped: 'Stopped',
    disconnected: 'Disconnected', interrupted: 'Interrupted',
  };
  return `${index + 1}. ${trackLink(entry)} — ${labels[entry.status]}`;
};

export type SessionMessagePayload = {
  content: string;
  embeds: EmbedBuilder[];
  components: SessionRow[];
  allowedMentions: {parse: never[]};
};

const message = (embed: EmbedBuilder, components: SessionRow[]): SessionMessagePayload => ({
  content: '', embeds: [embed], components, allowedMentions: {parse: []},
});

const embedTextLength = (embed: EmbedBuilder): number => {
  const {title = '', description = '', footer, author, fields = []} = embed.data;
  return title.length + description.length + (footer?.text.length ?? 0) + (author?.name.length ?? 0)
    + fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
};

const historyEmbed = (title: string) => new EmbedBuilder().setColor(0x365c65).setTitle(title);

/** Fill the current message before adding another, keeping each entry intact. */
const appendHistory = (messages: SessionMessagePayload[], session: ListeningSessionRecord): SessionMessagePayload[] => {
  const lines = session.entries.length > 0 ? session.entries.map(entryLine) : ['No tracks played.'];
  for (const line of lines) {
    let current = messages[messages.length - 1];
    let embed = current.embeds[current.embeds.length - 1];
    const description = embed.data.description ?? '';
    const addition = description ? `\n${line}` : line;
    const messageLength = current.embeds.reduce((length, item) => length + embedTextLength(item), 0);
    if (description.length + addition.length <= MAX_DESCRIPTION_LENGTH && messageLength + addition.length <= MAX_MESSAGE_EMBED_TEXT) {
      embed.setDescription(description + addition);
      continue;
    }

    embed = historyEmbed(CONTINUED_HISTORY_TITLE);
    if (current.embeds.length >= MAX_MESSAGE_EMBEDS || messageLength + embedTextLength(embed) + line.length > MAX_MESSAGE_EMBED_TEXT) {
      current = message(embed, []);
      messages.push(current);
    } else {
      current.embeds.push(embed);
    }

    embed.setDescription(line);
  }

  return messages;
};

const recapDescription = (session: ListeningSessionRecord): string => {
  const summary = session.endedAt
    ? `Session ended <t:${Math.floor(session.endedAt.getTime() / 1000)}:R>.`
    : 'Queue complete. Add a song to keep listening.';
  return `${summary}\n\n**Session history**`;
};

export const buildSessionMessages = (session: ListeningSessionRecord, player?: Player, queuePageSize = 10): SessionMessagePayload[] => {
  const active = !session.endedAt && player !== undefined;
  const current = active ? player.getCurrent() : null;
  const components: SessionRow[] = [];

  if (current && player) {
    components.push(row(
      button(session, 'previous', 'Previous', {disabled: !player.canGoBack()}),
      button(session, 'backward', '−10s', {disabled: current.isLive}),
      button(session, player.status === STATUS.PAUSED ? 'resume' : 'pause', player.status === STATUS.PAUSED ? 'Resume' : 'Pause', {style: ButtonStyle.Primary}),
      button(session, 'forward', '+10s', {disabled: current.isLive}),
      button(session, 'next', 'Next', {disabled: !player.canGoForward(1)}),
    ));
    components.push(row(
      button(session, 'queue', 'Queue'),
      button(session, 'shuffle', 'Shuffle', {disabled: player.isQueueEmpty()}),
    ));
  }

  if (current && player) {
    const embed = buildQueueEmbed(player, 1, queuePageSize);
    // Pagination belongs to the full queue view; an empty preview needs no summary.
    embed.setFields(player.isQueueEmpty() ? [] : (embed.data.fields ?? []).filter(field => field.name !== 'Page'));
    return [message(embed, components)];
  }

  const recap = historyEmbed('Session recap').setDescription(recapDescription(session));
  return appendHistory([message(recap, components)], session);
};

export const buildSessionMessage = (session: ListeningSessionRecord, player?: Player, queuePageSize = 10): SessionMessagePayload => buildSessionMessages(session, player, queuePageSize)[0];

const pagination = (session: ListeningSessionRecord, action: string, page: number, pages: number) => row(
  button(session, action, 'Previous page', {page: page - 1, disabled: page === 0}),
  button(session, action, 'Next page', {page: page + 1, disabled: page + 1 >= pages}),
);

export const buildHistoryMessages = (session: ListeningSessionRecord): SessionMessagePayload[] => appendHistory([
  message(historyEmbed('Session history'), []),
], session);

export const buildQueueMessage = (session: ListeningSessionRecord, player: Player, requestedPage = 0, pageSize = 10) => {
  const pages = Math.max(1, Math.ceil(player.queueSize() / pageSize));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const embed = buildQueueEmbed(player, page + 1, pageSize);
  return message(embed, pages > 1 ? [pagination(session, 'queue', page, pages)] : []);
};

export const buildMoreMessage = (session: ListeningSessionRecord, player: Player) => {
  const current = player.getCurrent();
  const seekDisabled = !current || current.isLive;
  const embed = new EmbedBuilder().setColor(0x365c65).setTitle('Playback controls')
    .setDescription('Playback controls are available to listeners in the bot\'s voice channel.');
  return message(embed, [row(
    button(session, 'backward', 'Back 10 seconds', {disabled: seekDisabled}),
    button(session, 'forward', 'Forward 10 seconds', {disabled: seekDisabled}),
    button(session, 'shuffle', 'Shuffle', {disabled: player.isQueueEmpty()}),
  )]);
};
