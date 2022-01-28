import {CommandInteraction, GuildMember} from 'discord.js';
import {inject, injectable} from 'inversify';
import {Except} from 'type-fest';
import shuffle from 'array-shuffle';
import {TYPES} from '../types.js';
import GetSongs from '../services/get-songs.js';
import {QueuedSong} from './player.js';
import PlayerManager from '../managers/player.js';
import {prisma} from '../utils/db.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';

@injectable()
export default class AddQueryToQueue {
  constructor(@inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs, @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager) {}

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    interaction: CommandInteraction;
  }): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);
    const wasPlayingSong = player.getCurrent() !== null;

    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await prisma.setting.findUnique({where: {guildId}});

    if (!settings) {
      throw new Error('Could not find settings for guild');
    }

    const {playlistLimit} = settings;

    await interaction.deferReply();

    let newSongs: Array<Except<QueuedSong, 'addedInChannelId' | 'requestedBy'>> = [];
    let extraMsg = '';

    // Test if it's a complete URL
    try {
      const url = new URL(query);

      const YOUTUBE_HOSTS = [
        'www.youtube.com',
        'youtu.be',
        'youtube.com',
        'music.youtube.com',
        'www.music.youtube.com',
      ];

      if (YOUTUBE_HOSTS.includes(url.host)) {
        // YouTube source
        if (url.searchParams.get('list')) {
          // YouTube playlist
          newSongs.push(...await this.getSongs.youtubePlaylist(url.searchParams.get('list')!));
        } else {
          const song = await this.getSongs.youtubeVideo(url.href);

          if (song) {
            newSongs.push(song);
          } else {
            throw new Error('that doesn\'t exist');
          }
        }
      } else if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
        const [convertedSongs, nSongsNotFound, totalSongs] = await this.getSongs.spotifySource(query, playlistLimit);

        if (totalSongs > playlistLimit) {
          extraMsg = `a random sample of ${playlistLimit} songs was taken`;
        }

        if (totalSongs > playlistLimit && nSongsNotFound !== 0) {
          extraMsg += ' and ';
        }

        if (nSongsNotFound !== 0) {
          if (nSongsNotFound === 1) {
            extraMsg += '1 song was not found';
          } else {
            extraMsg += `${nSongsNotFound.toString()} songs were not found`;
          }
        }

        newSongs.push(...convertedSongs);
      }
    } catch (_: unknown) {
      // Not a URL, must search YouTube
      const song = await this.getSongs.youtubeVideoSearch(query);

      if (song) {
        newSongs.push(song);
      } else {
        throw new Error('that doesn\'t exist');
      }
    }

    if (newSongs.length === 0) {
      throw new Error('no songs found');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    newSongs.forEach(song => {
      player.add({...song, addedInChannelId: interaction.channel!.id, requestedBy: interaction.member!.user.id}, {immediate: addToFrontOfQueue ?? false});
    });

    const firstSong = newSongs[0];

    let statusMsg = '';

    if (player.voiceConnection === null) {
      await player.connect(targetVoiceChannel);

      // Resume / start playback
      await player.play();

      if (wasPlayingSong) {
        statusMsg = 'resuming playback';
      }

      await interaction.editReply({
        embeds: [buildPlayingMessageEmbed(player)],
      });
    }

    // Build response message
    if (statusMsg !== '') {
      if (extraMsg === '') {
        extraMsg = statusMsg;
      } else {
        extraMsg = `${statusMsg}, ${extraMsg}`;
      }
    }

    if (extraMsg !== '') {
      extraMsg = ` (${extraMsg})`;
    }

    if (newSongs.length === 1) {
      await interaction.editReply(`u betcha, **${firstSong.title}** added to the${addToFrontOfQueue ? ' front of the' : ''} queue${extraMsg}`);
    } else {
      await interaction.editReply(`u betcha, **${firstSong.title}** and ${newSongs.length - 1} other songs were added to the queue${extraMsg}`);
    }
  }
}
