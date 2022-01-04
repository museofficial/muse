const createDatabaseUrl = (directory: string) => `file:${directory}/db.sqlite`;

export default createDatabaseUrl;
