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
  isLive: boolean;
}

export default class {
  private queue: QueuedSong[] = [];
  private position = 0;

  forward(): void {
    if (this.position + 1 <= this.size()) {
      this.position++;
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  back(): void {
    if (this.position - 1 >= 0) {
      this.position--;
    } else {
      throw new Error('No songs in queue to go back to.');
    }
  }

  get(): QueuedSong[] {
    return this.queue.slice(this.position);
  }

  add(song: QueuedSong): void {
    if (song.playlist) {
      // Add to end of queue
      this.queue.push(song);
    } else {
      // Not from playlist, add immediately
      let insertAt = 0;

      // Loop until playlist song
      this.queue.some(song => {
        if (song.playlist) {
          return true;
        }

        insertAt++;
        return false;
      });

      this.queue = [...this.queue.slice(0, insertAt), song, ...this.queue.slice(insertAt)];
    }
  }

  shuffle(): void {
    this.queue = [this.queue[0], ...shuffle(this.queue.slice(1))];
  }

  clear(): void {
    const newQueue = [];

    // Don't clear curently playing song
    if (this.queue.length > 0) {
      newQueue.push(this.queue[0]);
    }

    this.queue = newQueue;
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.get().length === 0;
  }
}
