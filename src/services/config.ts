import dotenv from 'dotenv';
import 'reflect-metadata';
import {injectable} from 'inversify';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import xbytes from 'xbytes';
import {ConditionalKeys} from 'type-fest';
import {ActivityType, PresenceStatusData} from 'discord.js';
import {DEFAULT_PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS} from '../utils/constants.js';
dotenv.config({path: process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env')});

export const DATA_DIR = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : './data');

const firstNonEmpty = (...values: Array<string | undefined>) => values
  .map(value => value?.trim())
  .find((value): value is string => Boolean(value));

const CONFIG_MAP = {
  DISCORD_TOKEN: firstNonEmpty(process.env.DISCORD_TOKEN),
  YOUTUBE_API_KEY: firstNonEmpty(process.env.YOUTUBE_API_KEY),
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? '',
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  REGISTER_COMMANDS_ON_BOT: process.env.REGISTER_COMMANDS_ON_BOT === 'true',
  DATA_DIR,
  CACHE_DIR: path.join(DATA_DIR, 'cache'),
  CACHE_LIMIT_IN_BYTES: xbytes.parseSize(process.env.CACHE_LIMIT ?? '2GB'),
  BOT_STATUS: process.env.BOT_STATUS ?? 'online',
  BOT_ACTIVITY_TYPE: process.env.BOT_ACTIVITY_TYPE ?? 'LISTENING',
  BOT_ACTIVITY_URL: process.env.BOT_ACTIVITY_URL ?? '',
  BOT_ACTIVITY: process.env.BOT_ACTIVITY ?? 'music',
  BOT_LOCALE: process.env.BOT_LOCALE ?? '',
  ENABLE_SPONSORBLOCK: process.env.ENABLE_SPONSORBLOCK === 'true',
  SPONSORBLOCK_TIMEOUT: parseInt(process.env.SPONSORBLOCK_TIMEOUT ?? '5', 10),
  PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS: Number(
    process.env.PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS ?? DEFAULT_PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS,
  ),
  YT_DLP_PATH: firstNonEmpty(process.env.YT_DLP_PATH, process.env.MUSE_BUNDLED_YT_DLP_PATH) ?? 'yt-dlp',
  YT_DLP_AUTO_UPDATE: process.env.YT_DLP_AUTO_UPDATE === 'true',
  INTRO_SOUND: process.env.INTRO_SOUND ?? '',
  OUTRO_SOUND: process.env.OUTRO_SOUND ?? '',
} as const;

const BUNDLED_SOUNDS_DIR = fileURLToPath(new URL('../sounds', import.meta.url));

type SoundSlot = 'intro' | 'outro';

const listOggFiles = (directory: string): string[] => {
  try {
    return fs.readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isFile() && entry.name.endsWith('.ogg'))
      .map(entry => path.basename(entry.name, '.ogg'));
  } catch {
    return [];
  }
};

/**
 * Finds a bundled clip's file. Slot-specific clips live in sounds/intro/ or sounds/outro/;
 * clips directly in sounds/ work for both slots, and a slot-specific clip wins on a name clash.
 */
const getBundledSoundPath = (slot: SoundSlot, name: string): string | undefined => {
  for (const directory of [path.join(BUNDLED_SOUNDS_DIR, slot), BUNDLED_SOUNDS_DIR]) {
    if (listOggFiles(directory).includes(name)) {
      return path.join(directory, `${name}.ogg`);
    }
  }

  return undefined;
};

/** Lists the clips shipped with Muse for a slot, such as `dark` for sounds/intro/dark.ogg. */
export const getBundledSoundNames = (slot: SoundSlot): string[] => [...new Set([
  ...listOggFiles(path.join(BUNDLED_SOUNDS_DIR, slot)),
  ...listOggFiles(BUNDLED_SOUNDS_DIR),
])].sort();

/**
 * Resolves a bundled clip name or a custom file path to an absolute path; empty or `none` disables the clip.
 * A clip that can't be found is disabled with an error log rather than stopping startup.
 */
const resolveSoundClip = (key: string, slot: SoundSlot, value: string): string => {
  if (value === '' || value.toLowerCase() === 'none') {
    return '';
  }

  const bundledPath = getBundledSoundPath(slot, value.toLowerCase());
  if (bundledPath) {
    return bundledPath;
  }

  const soundPath = path.resolve(value);
  if (!fs.existsSync(soundPath)) {
    console.error(`Ignoring ${key}: "${value}" is not a bundled sound (${getBundledSoundNames(slot).join(', ')}) and no file exists at ${soundPath}. The ${slot} is disabled.`);
    return '';
  }

  return soundPath;
};

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
  readonly BOT_LOCALE!: string;
  readonly ENABLE_SPONSORBLOCK!: boolean;
  readonly SPONSORBLOCK_TIMEOUT!: number;
  readonly PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS!: number;
  readonly YT_DLP_PATH!: string;
  readonly YT_DLP_AUTO_UPDATE!: boolean;
  // Absolute paths to the selected clips, or '' when disabled.
  readonly INTRO_SOUND!: string;
  readonly OUTRO_SOUND!: string;

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
        if (key === 'PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS'
          && (!Number.isInteger(value) || value < 1)) {
          throw new Error('Invalid numeric value for PLAYING_MESSAGE_UPDATE_INTERVAL_SECONDS: value must be a positive whole number');
        }

        if (!Number.isFinite(value)) {
          throw new Error(`Invalid numeric value for ${key}`);
        }

        if (key === 'CACHE_LIMIT_IN_BYTES' && value < 0) {
          throw new Error('Invalid numeric value for CACHE_LIMIT_IN_BYTES: value must be non-negative');
        }

        this[key as ConditionalKeys<typeof CONFIG_MAP, number>] = value;
      } else if (typeof value === 'string') {
        if (key === 'INTRO_SOUND' || key === 'OUTRO_SOUND') {
          this[key] = resolveSoundClip(key, key === 'INTRO_SOUND' ? 'intro' : 'outro', value.trim());
          continue;
        }

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
