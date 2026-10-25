import {randomUUID} from 'node:crypto';
import debug from '../utils/debug.js';
import {MediaSource, type QueuedSong} from './player-types.js';
import type SessionHistoryStore from './session-history-store.js';

export type ListeningSessionEntryStatus = 'playing' | 'completed' | 'skipped' | 'stopped' | 'disconnected' | 'interrupted';
export type ListeningSessionEndReason = 'stopped' | 'disconnected' | 'interrupted';

export interface ListeningSessionEntry {
  id: string;
  title: string;
  artist: string;
  url: string;
  source: string;
  length: number;
  offset: number;
  requestedBy: string;
  startedAt: Date;
  endedAt: Date | null;
  status: ListeningSessionEntryStatus;
}

export interface ListeningSessionRecord {
  id: string;
  guildId: string;
  voiceChannelId: string;
  channelId: string | null;
  messageId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  entries: ListeningSessionEntry[];
}

export const cloneListeningSession = (record: ListeningSessionRecord): ListeningSessionRecord => ({
  ...record,
  startedAt: new Date(record.startedAt),
  endedAt: record.endedAt ? new Date(record.endedAt) : null,
  entries: record.entries.map(entry => ({
    ...entry,
    startedAt: new Date(entry.startedAt),
    endedAt: entry.endedAt ? new Date(entry.endedAt) : null,
  })),
});

type TrackMetadata = Pick<QueuedSong, 'title' | 'artist' | 'url' | 'source' | 'length' | 'offset' | 'requestedBy'>;

export default class ListeningSession {
  private record?: ListeningSessionRecord;
  private currentQueueEntryId?: number;
  private pendingWrites: Promise<void> = Promise.resolve();
  private readonly failedWrites = new Map<string, {snapshot: ListeningSessionRecord; error: unknown}>();

  constructor(private readonly guildId: string, private readonly store: Pick<SessionHistoryStore, 'save'>) {}

  /** Reserve the shared card while audio buffers; history starts on Playing. */
  prepare(voiceChannelId: string, channelId?: string): void {
    const previous = this.record;
    this.ensureRecord(voiceChannelId, channelId);
    if (this.record !== previous) {
      this.scheduleSave();
    } else if (channelId !== undefined) {
      this.setChannel(channelId);
    }
  }

  startTrack(song: TrackMetadata, voiceChannelId: string, queueEntryId: number): void {
    if (this.currentQueueEntryId === queueEntryId && this.record?.entries.at(-1)?.status === 'playing') {
      return;
    }

    const now = new Date();
    const record = this.ensureRecord(voiceChannelId);

    const previous = record.entries.at(-1);
    if (previous?.status === 'playing') {
      previous.status = 'interrupted';
      previous.endedAt = now;
    }

    record.entries.push({
      id: randomUUID(),
      title: song.title,
      artist: song.artist,
      url: song.url,
      source: MediaSource[song.source],
      length: song.length,
      offset: song.offset,
      requestedBy: song.requestedBy,
      startedAt: now,
      endedAt: null,
      status: 'playing',
    });
    this.currentQueueEntryId = queueEntryId;
    this.scheduleSave();
  }

  endTrack(status: Exclude<ListeningSessionEntryStatus, 'playing'>): void {
    const entry = this.record?.entries.at(-1);
    if (!entry || entry.status !== 'playing') {
      return;
    }

    entry.status = status;
    entry.endedAt = new Date();
    this.currentQueueEntryId = undefined;
    this.scheduleSave();
  }

  finish(reason: ListeningSessionEndReason): void {
    if (!this.record || this.record.endedAt) {
      return;
    }

    const now = new Date();
    const entry = this.record.entries.at(-1);
    if (entry?.status === 'playing') {
      entry.status = reason;
      entry.endedAt = now;
    }

    this.record.endedAt = now;
    this.record.endReason = reason;
    this.currentQueueEntryId = undefined;
    this.scheduleSave();
    void this.flush().catch(() => {
      console.error(`Could not persist listening session history for guild ${this.guildId}.`);
    });
  }

  snapshot(): ListeningSessionRecord | undefined {
    return this.record ? cloneListeningSession(this.record) : undefined;
  }

  setChannel(channelId: string): void {
    if (this.record && this.record.channelId === null) {
      this.record.channelId = channelId;
      this.scheduleSave();
    }
  }

  async setMessage(channelId: string, messageId: string | null): Promise<void> {
    if (this.record?.channelId && this.record.channelId !== channelId) {
      throw new Error('A listening session cannot move to another text channel.');
    }

    const binding = this.record;
    const previous = this.snapshot();
    if (this.record && (this.record.channelId !== channelId || this.record.messageId !== messageId)) {
      this.record.channelId = channelId;
      this.record.messageId = messageId;
      this.scheduleSave();
    }

    try {
      await this.flush();
    } catch (error) {
      if (previous && binding?.messageId === messageId) {
        // Retain newer playback history, but do not keep a failed card binding.
        // Queue this replacement behind failed saves so a later flush cannot
        // retry the rejected binding after we restore its predecessor.
        binding.messageId = previous.messageId;
        this.scheduleSave(binding);
        await this.flush().catch(() => undefined);
      }

      throw error;
    }
  }

  async flush(): Promise<void> {
    // Retry behind pending state changes so an older failed snapshot cannot
    // overwrite a newer successful save. Keep failures from ended sessions too.
    const retried = this.pendingWrites.then(async () => {
      await [...this.failedWrites.values()].reduce(async (previous, failure) => {
        await previous;
        await this.saveSnapshot(failure.snapshot);
      }, Promise.resolve());
    });
    this.pendingWrites = retried;
    await retried;
    const failure = this.failedWrites.values().next().value as {error: unknown} | undefined;
    if (failure) {
      throw failure.error;
    }
  }

  private ensureRecord(voiceChannelId: string, channelId?: string): ListeningSessionRecord {
    if (!this.record || this.record.endedAt) {
      this.record = {
        id: randomUUID(), guildId: this.guildId, voiceChannelId,
        channelId: channelId ?? null, messageId: null, startedAt: new Date(),
        endedAt: null, endReason: null, entries: [],
      };
    }

    return this.record;
  }

  private scheduleSave(record = this.record): void {
    if (!record) {
      return;
    }

    const snapshot = cloneListeningSession(record);
    this.pendingWrites = this.pendingWrites.then(async () => this.saveSnapshot(snapshot));
  }

  private async saveSnapshot(snapshot: ListeningSessionRecord): Promise<void> {
    try {
      await this.store.save(snapshot);
      this.failedWrites.delete(snapshot.id);
    } catch (error: unknown) {
      this.failedWrites.set(snapshot.id, {snapshot, error});
      debug('Could not save listening session %s.', snapshot.id);
    }
  }
}
