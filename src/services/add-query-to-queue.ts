/* eslint-disable complexity */
import {ChatInputCommandInteraction, GuildMember} from 'discord.js';
import {inject, injectable} from 'inversify';
import shuffle from 'array-shuffle';
import {TYPES} from '../types.js';
import GetSongs from '../services/get-songs.js';
import {SongMetadata, STATUS} from './player.js';
import PlayerManager from '../managers/player.js';
import {prisma} from '../utils/db.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';

@injectable()
export default class AddQueryToQueue {
  constructor(@inject(TYPES.Services.GetSongs) private readonly getSongs: GetSongs, @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager) {
  }

  public async addToQueue({
    query,
    addToFrontOfQueue,
    shuffleAdditions,
    shouldSplitChapters,
    interaction,
  }: {
    query: string;
    addToFrontOfQueue: boolean;
    shuffleAdditions: boolean;
    shouldSplitChapters: boolean;
    interaction: ChatInputCommandInteraction;
  }): Promise<void> {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);
    const wasPlayingSong = player.getCurrent() !== null;

    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await prisma.setting.findUnique({where: {guildId}});

    if (!settings) {
      throw new Error('keine Einstellungen für den Server gefunden');
    }

    const {playlistLimit} = settings;

    await interaction.deferReply();

    let newSongs: SongMetadata[] = [];
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
          newSongs.push(...await this.getSongs.youtubePlaylist(url.searchParams.get('list')!, shouldSplitChapters));
        } else {
          const songs = await this.getSongs.youtubeVideo(url.href, shouldSplitChapters);

          if (songs) {
            newSongs.push(...songs);
          } else {
            throw new Error('das existiert nicht');
          }
        }
      } else if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
        const [convertedSongs, nSongsNotFound, totalSongs] = await this.getSongs.spotifySource(query, playlistLimit, shouldSplitChapters);

        if (totalSongs > playlistLimit) {
          extraMsg = `eine zufällige Auswahl von ${playlistLimit} Liedern wurde genommen`;
        }

        if (totalSongs > playlistLimit && nSongsNotFound !== 0) {
          extraMsg += ' and ';
        }

        if (nSongsNotFound !== 0) {
          if (nSongsNotFound === 1) {
            extraMsg += '1 Song konnte nicht gefunden werden';
          } else {
            extraMsg += `${nSongsNotFound.toString()} Songs konnten nicht gefunden werden`;
          }
        }

        newSongs.push(...convertedSongs);
      } else {
        const song = await this.getSongs.httpLiveStream(query);

        if (song) {
          newSongs.push(song);
        } else {
          throw new Error('das existiert nicht');
        }
      }
    } catch (_: unknown) {
      // Not a URL, must search YouTube
      const songs = await this.getSongs.youtubeVideoSearch(query, shouldSplitChapters);

      if (songs) {
        newSongs.push(...songs);
      } else {
        throw new Error('das existiert nicht');
      }
    }

    if (newSongs.length === 0) {
      throw new Error('keine Songs gefunden');
    }

    if (shuffleAdditions) {
      newSongs = shuffle(newSongs);
    }

    newSongs.forEach(song => {
      player.add({
        ...song,
        addedInChannelId: interaction.channel!.id,
        requestedBy: interaction.member!.user.id,
      }, {immediate: addToFrontOfQueue ?? false});
    });

    const firstSong = newSongs[0];

    let statusMsg = '';

    if (player.voiceConnection === null) {
      await player.connect(targetVoiceChannel);

      // Resume / start playback
      await player.play();

      if (wasPlayingSong) {
        statusMsg = 'Wiedergabe fortsetzen';
      }

      await interaction.editReply({
        embeds: [buildPlayingMessageEmbed(player)],
      });
    } else if (player.status === STATUS.IDLE) {
      // Player is idle, start playback instead
      await player.play();
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
      await interaction.editReply(`Alles klar, **${firstSong.title}** hinzugefügt zu der${addToFrontOfQueue ? ' vor der' : ''} Warteschlange${extraMsg}`);
    } else {
      await interaction.editReply(`Alles klar, **${firstSong.title}** und ${newSongs.length - 1} andere Songs wurden zur Warteschlange hinzugefügt${extraMsg}`);
    }
  }
}
