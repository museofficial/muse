import {join} from 'path';

export const createDatabasePath = (directory: string) => join(directory, 'db.sqlite');

export const createDatabasePathFromUrl = (databaseUrl: string, platform = process.platform) => {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('SQLite DATABASE_URL must use the file: protocol');
  }

  const databasePath = databaseUrl.slice('file:'.length).split('?', 1)[0];

  if (platform === 'win32') {
    return databasePath.replaceAll(/\\\\/g, '\\');
  }

  return databasePath;
};

const createDatabaseUrl = (directory: string) => {
  const url = `file:${createDatabasePath(directory)}?socket_timeout=10&connection_limit=1`;

  if (process.platform === 'win32') {
    return url.replaceAll(/\\/g, '\\\\');
  }

  return url;
};

export default createDatabaseUrl;
