import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

export const DISCORD_TOKEN: string = process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN : '';
export const DISCORD_CLIENT_ID: string = process.env.DISCORD_CLIENT_ID ? process.env.DISCORD_CLIENT_ID : '';
export const DATA_DIR = path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : './data');
