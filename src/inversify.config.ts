import 'reflect-metadata';
import {Container} from 'inversify';
import {TYPES} from './types.js';
import Bot from './bot.js';
import {Client} from 'discord.js';
import ConfigProvider from './services/config.js';

// Managers
import PlayerManager from './managers/player.js';

// Helpers
import GetSongs from './services/get-songs.js';
import NaturalLanguage from './services/natural-language-commands.js';

// Comands
import Command from './commands';
import Clear from './commands/clear.js';
import Config from './commands/config.js';
import Disconnect from './commands/disconnect.js';
import ForwardSeek from './commands/fseek.js';
import Help from './commands/help.js';
import Pause from './commands/pause.js';
import Play from './commands/play.js';
import QueueCommad from './commands/queue.js';
import Seek from './commands/seek.js';
import Shortcuts from './commands/shortcuts.js';
import Shuffle from './commands/shuffle.js';
import Skip from './commands/skip.js';
import Unskip from './commands/unskip.js';
import ThirdParty from './services/third-party.js';
import CacheProvider from './services/cache.js';

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
container.bind(TYPES.Config).toConstantValue(new ConfigProvider());

// Static libraries
container.bind(TYPES.ThirdParty).to(ThirdParty);

container.bind(TYPES.Cache).to(CacheProvider);

export default container;
