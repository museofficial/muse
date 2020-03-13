export const TYPES = {
  Bot: Symbol('Bot'),
  Client: Symbol('Client'),
  Config: {
    DISCORD_TOKEN: Symbol('DISCORD_TOKEN'),
    DISCORD_CLIENT_ID: Symbol('DISCORD_CLIENT_ID'),
    YOUTUBE_API_KEY: Symbol('YOUTUBE_API_KEY'),
    DATA_DIR: Symbol('DATA_DIR'),
    CACHE_DIR: Symbol('CACHE_DIR')
  },
  Command: Symbol('Command'),
  Services: {
    Player: Symbol('Player'),
    Queue: Symbol('Queue')
  },
  Lib: {
    YouTube: Symbol('YouTube'),
    Spotify: Symbol('Spotify')
  }
};
