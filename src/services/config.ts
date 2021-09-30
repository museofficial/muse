import dotenv from 'dotenv';
import {injectable} from 'inversify';
import path from 'path';
dotenv.config();

export const DATA_DIR = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : './data');
const DEFAULT_PLAYLIST_LIMIT = 50;

const CONFIG_MAP = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  DATA_DIR,
  CACHE_DIR: path.join(DATA_DIR, 'cache'),
  PLAYLIST_LIMIT: process.env.PLAYLIST_LIMIT,
} as const;

@injectable()
export default class Config {
  readonly DISCORD_TOKEN!: string;
  readonly YOUTUBE_API_KEY!: string;
  readonly SPOTIFY_CLIENT_ID!: string;
  readonly SPOTIFY_CLIENT_SECRET!: string;
  readonly DATA_DIR!: string;
  readonly CACHE_DIR!: string;
  readonly PLAYLIST_LIMIT!: string;

  constructor() {
    for (const [key, value] of Object.entries(CONFIG_MAP)) {
      if (typeof value === 'undefined') {
        console.error(`Missing environment variable for ${key}`);
        process.exit(1);
      }

      this[key as keyof typeof CONFIG_MAP] = value;
    }
  }

  getPlaylistLimit() {
    if (!this.PLAYLIST_LIMIT) {
      return DEFAULT_PLAYLIST_LIMIT;
    }

    return Number(this.PLAYLIST_LIMIT) || DEFAULT_PLAYLIST_LIMIT;
  }
}
