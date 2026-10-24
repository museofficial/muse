import {ButtonStyle, EmbedBuilder, escapeMarkdown} from 'discord.js';
import type Player from '../services/player.js';
import {MediaSource, STATUS} from '../services/player-types.js';
import type {ListeningSessionEntry, ListeningSessionRecord} from '../services/listening-session.js';
import {prettyTime} from './time.js';
import {truncate} from './string.js';

export const SESSION_BUTTON_PREFIX = 'muse-session:';
const PAGE_SIZE = 5;

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

const message = (embed: EmbedBuilder, components: SessionRow[]) => ({
  content: '', embeds: [embed], components, allowedMentions: {parse: [] as never[]},
});

const recapDescription = (session: ListeningSessionRecord): string => {
  const first = Math.max(0, session.entries.length - PAGE_SIZE);
  const history = session.entries.slice(first).map((entry, index) => entryLine(entry, first + index)).join('\n');
  const summary = session.endedAt
    ? `Session ended <t:${Math.floor(session.endedAt.getTime() / 1000)}:R>.`
    : 'Queue complete. Add a song to keep listening.';
  return `${summary}\n\n**${session.entries.length > PAGE_SIZE ? 'Recently played' : 'Session history'}**\n${history || 'No tracks played.'}`;
};

export const buildSessionMessage = (session: ListeningSessionRecord, player?: Player) => {
  const active = !session.endedAt && player !== undefined;
  const current = active ? player.getCurrent() : null;
  const embed = new EmbedBuilder().setColor(0x365c65);
  const components: SessionRow[] = [];

  if (current && player) {
    const upcoming = player.getQueue();
    const time = current.isLive ? 'Live stream' : `${prettyTime(player.getPosition())} / ${prettyTime(current.length)}`;
    const source = MediaSource[current.source];
    const playbackDetails = [time, `Volume ${player.getVolume()}%`];
    if (player.loopCurrentSong) {
      playbackDetails.push('Loop: song');
    }

    if (player.loopCurrentQueue) {
      playbackDetails.push('Loop: queue');
    }

    const description = [
      `**${trackLink(current, 180)}**`,
      `Requested by <@${current.requestedBy}> · ${source}`,
      playbackDetails.join(' · '),
      '',
      `**Up next · ${upcoming.length} ${upcoming.length === 1 ? 'track' : 'tracks'}**`,
      upcoming.slice(0, 3).map((track, index) => `${index + 1}. ${trackLink(track)}`).join('\n') || 'Nothing queued yet.',
    ].join('\n');
    embed.setTitle(player.status === STATUS.PAUSED ? 'Paused' : 'Now playing').setDescription(description)
      .setFooter({text: truncate(current.artist || 'Listening session', 200)});
    components.push(row(
      button(session, 'previous', 'Previous', {disabled: !player.canGoBack()}),
      button(session, player.status === STATUS.PAUSED ? 'resume' : 'pause', player.status === STATUS.PAUSED ? 'Resume' : 'Pause', {style: ButtonStyle.Primary}),
      button(session, 'next', 'Next', {disabled: !player.canGoForward(1)}),
    ));
  } else {
    embed.setTitle('Session recap').setDescription(recapDescription(session));
  }

  const secondary = [button(session, 'history', 'View full history')];
  if (active) {
    secondary.unshift(button(session, 'queue', 'Queue'));
    secondary.push(button(session, 'more', 'More'));
  }

  components.push(row(...secondary));
  return message(embed, components);
};

const pagination = (session: ListeningSessionRecord, action: string, page: number, pages: number) => row(
  button(session, action, 'Previous page', {page: page - 1, disabled: page === 0}),
  button(session, action, 'Next page', {page: page + 1, disabled: page + 1 >= pages}),
);

export const buildHistoryMessage = (session: ListeningSessionRecord, requestedPage = 0) => {
  const pages = Math.max(1, Math.ceil(session.entries.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const first = page * PAGE_SIZE;
  const description = session.entries.slice(first, first + PAGE_SIZE)
    .map((entry, index) => entryLine(entry, first + index)).join('\n') || 'No tracks played.';
  const embed = new EmbedBuilder().setColor(0x365c65).setTitle('Session history').setDescription(description)
    .setFooter({text: `Page ${page + 1} of ${pages} · ${session.entries.length} tracks started`});
  return message(embed, pages > 1 ? [pagination(session, 'history', page, pages)] : []);
};

export const buildQueueMessage = (session: ListeningSessionRecord, player: Player, requestedPage = 0) => {
  const queue = player.getQueue();
  const pages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  const first = page * PAGE_SIZE;
  const description = queue.slice(first, first + PAGE_SIZE).map((track, index) => `${first + index + 1}. ${trackLink(track)}`).join('\n');
  const embed = new EmbedBuilder().setColor(0x365c65).setTitle('Up next').setDescription(description || 'No upcoming tracks.')
    .setFooter({text: `Page ${page + 1} of ${pages} · ${queue.length} upcoming tracks`});
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
    button(session, 'stop', 'Stop and leave', {style: ButtonStyle.Danger}),
  )]);
};
