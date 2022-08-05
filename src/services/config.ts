import dotenv from 'dotenv';
import 'reflect-metadata';
import {injectable} from 'inversify';
import path from 'path';
import xbytes from 'xbytes';
import {ConditionalKeys} from 'type-fest';
import {ActivityType, PresenceStatusData} from 'discord.js';
dotenv.config();

export const DATA_DIR = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : './data');

const CONFIG_MAP = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  REGISTER_COMMANDS_ON_BOT: process.env.REGISTER_COMMANDS_ON_BOT === 'true',
  DATA_DIR,
  CACHE_DIR: path.join(DATA_DIR, 'cache'),
  CACHE_LIMIT_IN_BYTES: xbytes.parseSize(process.env.CACHE_LIMIT ?? '2GB'),
  BOT_STATUS: process.env.BOT_STATUS ?? 'online',
  BOT_ACTIVITY_TYPE: process.env.BOT_ACTIVITY_TYPE ?? 'LISTENING',
  BOT_ACTIVITY_URL: process.env.BOT_ACTIVITY_URL ?? '',
  BOT_ACTIVITY: process.env.BOT_ACTIVITY ?? 'music',
} as const;

const BOT_ACTIVITY_TYPE_MAP = {
  PLAYING: ActivityType.Playing,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  STREAMING: ActivityType.Streaming,
} as const;

@injectable()
export default class Config {
  readonly DISCORD_TOKEN!: string;
  readonly YOUTUBE_API_KEY!: string;
  readonly SPOTIFY_CLIENT_ID!: string;
  readonly SPOTIFY_CLIENT_SECRET!: string;
  readonly REGISTER_COMMANDS_ON_BOT!: boolean;
  readonly DATA_DIR!: string;
  readonly CACHE_DIR!: string;
  readonly CACHE_LIMIT_IN_BYTES!: number;
  readonly BOT_STATUS!: PresenceStatusData;
  readonly BOT_ACTIVITY_TYPE!: Exclude<ActivityType, ActivityType.Custom>;
  readonly BOT_ACTIVITY_URL!: string;
  readonly BOT_ACTIVITY!: string;

  constructor() {
    for (const [key, value] of Object.entries(CONFIG_MAP)) {
      if (typeof value === 'undefined') {
        console.error(`Missing environment variable for ${key}`);
        process.exit(1);
      }

      if (key === 'BOT_ACTIVITY_TYPE') {
        this[key] = BOT_ACTIVITY_TYPE_MAP[(value as string).toUpperCase() as keyof typeof BOT_ACTIVITY_TYPE_MAP];
        continue;
      }

      if (typeof value === 'number') {
        this[key as ConditionalKeys<typeof CONFIG_MAP, number>] = value;
      } else if (typeof value === 'string') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (this as any)[key] = value.trim();
      } else if (typeof value === 'boolean') {
        this[key as ConditionalKeys<typeof CONFIG_MAP, boolean>] = value;
      } else {
        throw new Error(`Unsupported type for ${key}`);
      }
    }
  }
}
