export const createDatabasePath = (directory: string) => `${directory}/db.sqlite`;

const createDatabaseUrl = (directory: string) => `file:${createDatabasePath(directory)}`;

export default createDatabaseUrl;
