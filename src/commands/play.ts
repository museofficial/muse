import {TextChannel, Message} from 'discord.js';
import {URL} from 'url';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import {QueuedSong} from '../services/queue';
import {STATUS} from '../services/player';
import QueueManager from '../managers/queue';
import PlayerManager from '../managers/player';
import {getMostPopularVoiceChannel} from '../utils/channels';
import LoadingMessage from '../utils/loading-message';
import errorMsg from '../utils/error-msg';
import Command from '.';
import GetSongs from '../services/get-songs';

@injectable()
export default class implements Command {
  public name = 'play';
  public examples = [
    ['play', 'resume paused playback'],
    ['play https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'plays a YouTube video'],
    ['play cool music', 'plays the first search result for "cool music" from YouTube'],
    ['play https://www.youtube.com/watch?list=PLi9drqWffJ9FWBo7ZVOiaVy0UQQEm4IbP', 'adds the playlist to the queue'],
    ['play https://open.spotify.com/track/3ebXMykcMXOcLeJ9xZ17XH?si=tioqSuyMRBWxhThhAW51Ig', 'plays a song from Spotify'],
    ['play https://open.spotify.com/album/5dv1oLETxdsYOkS2Sic00z?si=bDa7PaloRx6bMIfKdnvYQw', 'adds all songs from album to the queue'],
    ['play https://open.spotify.com/playlist/37i9dQZF1DX94qaYRnkufr?si=r2fOVL_QQjGxFM5MWb84Xw', 'adds all songs from playlist to the queue']
  ];

  private readonly queueManager: QueueManager;
  private readonly playerManager: PlayerManager;
  private readonly getSongs: GetSongs;

  constructor(@inject(TYPES.Managers.Queue) queueManager: QueueManager, @inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Services.GetSongs) getSongs: GetSongs) {
    this.queueManager = queueManager;
    this.playerManager = playerManager;
    this.getSongs = getSongs;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const [targetVoiceChannel, nInChannel] = getMostPopularVoiceChannel(msg.guild!);

    const res = new LoadingMessage(msg.channel as TextChannel);
    await res.start();

    if (nInChannel === 0) {
      await res.stop(errorMsg('all voice channels are empty'));
      return;
    }

    const queue = this.queueManager.get(msg.guild!.id);

    const queueOldSize = queue.size();

    if (args.length === 0) {
      if (this.playerManager.get(msg.guild!.id).status === STATUS.PLAYING) {
        await res.stop(errorMsg('already playing, give me a song name'));
        return;
      }

      // Must be resuming play
      if (queue.get().length === 0 && !queue.getCurrent()) {
        await res.stop(errorMsg('nothing to play'));
        return;
      }

      await this.playerManager.get(msg.guild!.id).connect(targetVoiceChannel);
      await this.playerManager.get(msg.guild!.id).play();

      await res.stop('the stop-and-go light is now green');
      return;
    }

    const newSongs: QueuedSong[] = [];

    // Test if it's a complete URL
    try {
      const url = new URL(args[0]);

      const YOUTUBE_HOSTS = ['www.youtube.com', 'youtu.be', 'youtube.com'];

      if (YOUTUBE_HOSTS.includes(url.host)) {
        // YouTube source
        if (url.searchParams.get('list')) {
          // YouTube playlist
          newSongs.push(...await this.getSongs.youtubePlaylist(url.searchParams.get('list') as string));
        } else {
          // Single video
          const song = await this.getSongs.youtubeVideo(url.href);

          if (song) {
            newSongs.push(song);
          } else {
            await res.stop(errorMsg('that doesn\'t exist'));
            return;
          }
        }
      } else if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
        const [convertedSongs] = await this.getSongs.spotifySource(args[0]);

        newSongs.push(...convertedSongs);
      }
    } catch (_) {
      // Not a URL, must search YouTube
      const query = args.join(' ');

      const song = await this.getSongs.youtubeVideoSearch(query);

      if (song) {
        newSongs.push(song);
      } else {
        await res.stop(errorMsg('that doesn\'t exist'));
        return;
      }
    }

    if (newSongs.length === 0) {
      await res.stop(errorMsg('no songs found'));
      return;
    }

    newSongs.forEach(song => queue.add(song));

    const firstSong = newSongs[0];

    if (newSongs.length === 1) {
      await res.stop(`u betcha, **${firstSong.title}** added to the queue`);
    } else {
      await res.stop(`u betcha, **${firstSong.title}** and ${newSongs.length - 1} other songs were added to the queue`);
    }

    if (this.playerManager.get(msg.guild!.id).voiceConnection === null) {
      await this.playerManager.get(msg.guild!.id).connect(targetVoiceChannel);
    }

    if (queueOldSize === 0) {
      // Only auto-play if queue was empty before
      await this.playerManager.get(msg.guild!.id).play();
    }
  }
}
