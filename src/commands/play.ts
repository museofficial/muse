import {CommandHandler} from '../interfaces';
import {getMostPopularVoiceChannel} from '../utils/channels';
import getYouTubeStream from '../utils/get-youtube-stream';

const play: CommandHandler = {
  name: 'play',
  description: 'plays a song',
  execute: async (msg, args) => {
    const url = args[0];

    const channel = getMostPopularVoiceChannel(msg.guild!);

    const conn = await channel.join();

    const stream = await getYouTubeStream(url);

    conn.play(stream, {type: 'webm/opus'});
  }
};

export default play;
