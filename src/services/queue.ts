import {injectable} from 'inversify';
import shuffle from 'array-shuffle';

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface QueuedSong {
  title: string;
  artist: string;
  url: string;
  length: number;
  playlist: QueuedPlaylist | null;
}

@injectable()
export default class {
  private readonly guildQueues = new Map<string, QueuedSong[]>();
  private readonly queuePositions = new Map<string, number>();

  forward(guildId: string): void {
    const currentPosition = this.queuePositions.get(guildId);

    if (currentPosition && currentPosition + 1 <= this.size(guildId)) {
      this.queuePositions.set(guildId, currentPosition + 1);
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  back(guildId: string): void {
    const currentPosition = this.queuePositions.get(guildId);

    if (currentPosition && currentPosition - 1 >= 0) {
      this.queuePositions.set(guildId, currentPosition - 1);
    } else {
      throw new Error('No songs in queue to go back to.');
    }
  }

  get(guildId: string): QueuedSong[] {
    const currentPosition = this.queuePositions.get(guildId);

    if (currentPosition === undefined) {
      return [];
    }

    const guildQueue = this.guildQueues.get(guildId);

    if (!guildQueue) {
      throw new Error('Bad state. Queue for guild exists but position does not.');
    }

    return guildQueue.slice(currentPosition);
  }

  add(guildId: string, song: QueuedSong): void {
    this.initQueue(guildId);

    if (song.playlist) {
      // Add to end of queue
      this.guildQueues.set(guildId, [...this.guildQueues.get(guildId)!, song]);
    } else if (this.guildQueues.get(guildId)!.length === 0) {
      // Queue is currently empty
      this.guildQueues.set(guildId, [song]);
    } else {
      // Not from playlist, add immediately
      let insertAt = 0;

      // Loop until playlist song
      this.guildQueues.get(guildId)!.some(song => {
        if (song.playlist) {
          return true;
        }

        insertAt++;
        return false;
      });

      this.guildQueues.set(guildId, [...this.guildQueues.get(guildId)!.slice(0, insertAt), song, ...this.guildQueues.get(guildId)!.slice(insertAt)]);
    }
  }

  shuffle(guildId: string): void {
    const queue = this.guildQueues.get(guildId);

    if (!queue) {
      throw new Error('Queue doesn\'t exist yet.');
    }

    this.guildQueues.set(guildId, [queue[0], ...shuffle(queue.slice(1))]);
  }

  clear(guildId: string): void {
    this.initQueue(guildId);
    const queue = this.guildQueues.get(guildId);

    const newQueue = [];

    if (queue!.length > 0) {
      newQueue.push(queue![0]);
    }

    this.guildQueues.set(guildId, newQueue);
  }

  size(guildId: string): number {
    return this.get(guildId).length;
  }

  private initQueue(guildId: string): void {
    if (!this.guildQueues.get(guildId)) {
      this.guildQueues.set(guildId, []);
      this.queuePositions.set(guildId, 0);
    }
  }
}
