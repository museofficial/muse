import 'reflect-metadata';
import {Container} from 'inversify';
import {TYPES} from './types';
import Bot from './bot';
import {Client} from 'discord.js';
import YouTube from 'youtube.ts';
import Spotify from 'spotify-web-api-node';
import {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  YOUTUBE_API_KEY,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  DATA_DIR,
  CACHE_DIR
} from './utils/config';

// Managers
import PlayerManager from './managers/player';
import QueueManager from './managers/queue';

// Comands
import Command from './commands';
import Clear from './commands/clear';
import Config from './commands/config';
import Play from './commands/play';
import QueueCommad from './commands/queue';
import Seek from './commands/seek';
import Shuffle from './commands/shuffle';

let container = new Container();

// Bot
container.bind<Bot>(TYPES.Bot).to(Bot).inSingletonScope();
container.bind<Client>(TYPES.Client).toConstantValue(new Client());

// Managers
container.bind<PlayerManager>(TYPES.Managers.Player).to(PlayerManager).inSingletonScope();
container.bind<QueueManager>(TYPES.Managers.Queue).to(QueueManager).inSingletonScope();

// Commands
container.bind<Command>(TYPES.Command).to(Clear).inSingletonScope();
container.bind<Command>(TYPES.Command).to(Config).inSingletonScope();
container.bind<Command>(TYPES.Command).to(Play).inSingletonScope();
container.bind<Command>(TYPES.Command).to(QueueCommad).inSingletonScope();
container.bind<Command>(TYPES.Command).to(Seek).inSingletonScope();
container.bind<Command>(TYPES.Command).to(Shuffle).inSingletonScope();

// Config values
container.bind<string>(TYPES.Config.DISCORD_TOKEN).toConstantValue(DISCORD_TOKEN);
container.bind<string>(TYPES.Config.DISCORD_CLIENT_ID).toConstantValue(DISCORD_CLIENT_ID);
container.bind<string>(TYPES.Config.YOUTUBE_API_KEY).toConstantValue(YOUTUBE_API_KEY);
container.bind<string>(TYPES.Config.DATA_DIR).toConstantValue(DATA_DIR);
container.bind<string>(TYPES.Config.CACHE_DIR).toConstantValue(CACHE_DIR);

// Static libraries
container.bind<YouTube>(TYPES.Lib.YouTube).toConstantValue(new YouTube(YOUTUBE_API_KEY));
container.bind<Spotify>(TYPES.Lib.Spotify).toConstantValue(new Spotify({clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET}));

export default container;
