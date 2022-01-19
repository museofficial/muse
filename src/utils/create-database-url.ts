import {join} from 'path';

export const createDatabasePath = (directory: string) => join(directory, 'db.sqlite');

const createDatabaseUrl = (directory: string) => `file:${createDatabasePath(directory)}`;

export default createDatabaseUrl;
