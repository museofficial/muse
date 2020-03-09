import {CommandHandler} from '../interfaces';

const config: CommandHandler = {
  name: 'config',
  description: 'Change various bot settings.',
  execute: (msg, args) => {
    const setting = args[0];

    switch (setting) {
      case 'prefix':
        msg.channel.send('Prefix set');
        break;

      case 'channel':
        msg.channel.send('Channel bound');
        break;

      default:
        msg.channel.send('Unknown setting');
    }
  }
};

export default config;
