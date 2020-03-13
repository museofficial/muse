import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

export const DISCORD_TOKEN: string = process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN : '';
export const DISCORD_CLIENT_ID: string = process.env.DISCORD_CLIENT_ID ? process.env.DISCORD_CLIENT_ID : '';
export const YOUTUBE_API_KEY: string = process.env.YOUTUBE_API_KEY ? process.env.YOUTUBE_API_KEY : '';
export const SPOTIFY_CLIENT_ID: string = process.env.SPOTIFY_CLIENT_ID ? process.env.SPOTIFY_CLIENT_ID : '';
export const SPOTIFY_CLIENT_SECRET: string = process.env.SPOTIFY_CLIENT_SECRET ? process.env.SPOTIFY_CLIENT_SECRET : '';
export const DATA_DIR = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : './data');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
