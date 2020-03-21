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

// Helpers
import GetSongs from './services/get-songs';
import NaturalLanguage from './services/natural-language-commands';

// Comands
import Command from './commands';
import Clear from './commands/clear';
import Config from './commands/config';
import Disconnect from './commands/disconnect';
import ForwardSeek from './commands/fseek';
import Help from './commands/help';
import Pause from './commands/pause';
import Play from './commands/play';
import QueueCommad from './commands/queue';
import Seek from './commands/seek';
import Shortcuts from './commands/shortcuts';
import Shuffle from './commands/shuffle';
import Skip from './commands/skip';
import Unskip from './commands/unskip';

let container = new Container();

// Bot
container.bind<Bot>(TYPES.Bot).to(Bot).inSingletonScope();
container.bind<Client>(TYPES.Client).toConstantValue(new Client());

// Managers
container.bind<PlayerManager>(TYPES.Managers.Player).to(PlayerManager).inSingletonScope();

// Helpers
container.bind<GetSongs>(TYPES.Services.GetSongs).to(GetSongs).inSingletonScope();
container.bind<NaturalLanguage>(TYPES.Services.NaturalLanguage).to(NaturalLanguage).inSingletonScope();

// Commands
[
  Clear,
  Config,
  Disconnect,
  ForwardSeek,
  Help,
  Pause,
  Play,
  QueueCommad,
  Seek,
  Shortcuts,
  Shuffle,
  Skip,
  Unskip
].forEach(command => {
  container.bind<Command>(TYPES.Command).to(command).inSingletonScope();
});

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
