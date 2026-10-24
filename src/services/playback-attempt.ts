export interface PlaybackAttemptToken {
  readonly id: number;
}

export interface PlaybackAttemptContext<Song, Connection> {
  readonly attempt: PlaybackAttemptToken;
  readonly song: Song;
  readonly queueEntryVersion: number;
  readonly connection: Connection;
}

export interface PlaybackOwnerSnapshot<Song, Connection> {
  readonly currentSong: Song | null;
  readonly queueEntryVersion: number | null;
  readonly currentConnection: Connection | null;
}

export class PlaybackAttemptTracker<Song, Connection> {
  private currentAttempt: PlaybackAttemptToken = {id: 0};

  constructor(private readonly getOwnerSnapshot: () => PlaybackOwnerSnapshot<Song, Connection>) {}

  begin(): PlaybackAttemptToken {
    this.currentAttempt = {id: this.currentAttempt.id + 1};
    return this.currentAttempt;
  }

  invalidate(): void {
    this.currentAttempt = {id: this.currentAttempt.id + 1};
  }

  latest(): PlaybackAttemptToken {
    return this.currentAttempt;
  }

  isLatest(attempt: PlaybackAttemptToken): boolean {
    return attempt.id === this.currentAttempt.id;
  }

  isCurrent(attempt: PlaybackAttemptToken, connection: Connection): boolean {
    return this.isLatest(attempt)
      && this.getOwnerSnapshot().currentConnection === connection;
  }

  capture(
    attempt: PlaybackAttemptToken,
    song: Song,
    queueEntryVersion: number,
    connection: Connection,
  ): PlaybackAttemptContext<Song, Connection> {
    return {attempt, song, queueEntryVersion, connection};
  }

  owns(context: PlaybackAttemptContext<Song, Connection>): boolean {
    const owner = this.getOwnerSnapshot();
    return this.isLatest(context.attempt)
      && owner.currentSong === context.song
      && owner.queueEntryVersion === context.queueEntryVersion
      && owner.currentConnection === context.connection;
  }
}
