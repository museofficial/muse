import 'reflect-metadata';
import {Container} from 'inversify';
import {TYPES} from './types';
import Bot from './bot';
import {Client} from 'discord.js';
import ConfigProvider from './services/config';

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
import ThirdParty from './services/third-party';

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

export default container;
