import type {SongMetadata} from '../services/player-types.js';

// Include both boundaries so a full track and its first chapter stay distinct.
const songKey = (song: SongMetadata) => JSON.stringify([song.source, song.url, song.offset, song.length]);

/** Keep the first request for each source interval, excluding already played entries. */
export default function uniqueSongs<T extends SongMetadata>(songs: T[], excluded: SongMetadata[] = []): T[] {
  const seen = new Set(excluded.map(songKey));
  return songs.filter(song => {
    const key = songKey(song);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
