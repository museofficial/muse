import {CommandInteraction, GuildMember} from 'discord.js';
import {URL} from 'url';
import {Except} from 'type-fest';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Command from '.';
import {TYPES} from '../types.js';
import {QueuedSong, STATUS} from '../services/player.js';
import PlayerManager from '../managers/player.js';
import {getMostPopularVoiceChannel, getMemberVoiceChannel} from '../utils/channels.js';
import errorMsg from '../utils/error-msg.js';
import GetSongs from '../services/get-songs.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('play')
    // TODO: make sure verb tense is consistent between all command descriptions
    .setDescription('play a song or resume playback')
    .addStringOption(option => option
      .setName('query')
      .setDescription('YouTube URL, Spotify URL, or search query'))
    .addBooleanOption(option => option
      .setName('immediate')
      .setDescription('adds track to the front of the queue'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly getSongs: GetSongs;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Services.GetSongs) getSongs: GetSongs) {
    this.playerManager = playerManager;
    this.getSongs = getSongs;
  }

  // eslint-disable-next-line complexity
  public async executeFromInteraction(interaction: CommandInteraction): Promise<void> {
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const player = this.playerManager.get(interaction.guild!.id);
    const wasPlayingSong = player.getCurrent() !== null;

    const query = interaction.options.getString('query');

    if (!query) {
      if (player.status === STATUS.PLAYING) {
        await interaction.reply({content: errorMsg('already playing, give me a song name'), ephemeral: true});
        return;
      }

      // Must be resuming play
      if (!wasPlayingSong) {
        await interaction.reply({content: errorMsg('nothing to play'), ephemeral: true});
        return;
      }

      await player.connect(targetVoiceChannel);
      await player.play();

      await interaction.reply('the stop-and-go light is now green');
      return;
    }

    const addToFrontOfQueue = interaction.options.getBoolean('immediate');

    const newSongs: Array<Except<QueuedSong, 'addedInChannelId'>> = [];
    let extraMsg = '';

    await interaction.deferReply();

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
          // Single video
          const song = await this.getSongs.youtubeVideo(url.href);

          if (song) {
            newSongs.push(song);
          } else {
            await interaction.editReply(errorMsg('that doesn\'t exist'));
            return;
          }
        }
      } else if (url.protocol === 'spotify:' || url.host === 'open.spotify.com') {
        const [convertedSongs, nSongsNotFound, totalSongs] = await this.getSongs.spotifySource(query);

        if (totalSongs > 50) {
          extraMsg = 'a random sample of 50 songs was taken';
        }

        if (totalSongs > 50 && nSongsNotFound !== 0) {
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
        await interaction.editReply(errorMsg('that doesn\'t exist'));
        return;
      }
    }

    if (newSongs.length === 0) {
      await interaction.editReply(errorMsg('no songs found'));
      return;
    }

    newSongs.forEach(song => {
      player.add({...song, addedInChannelId: interaction.channel?.id}, {immediate: addToFrontOfQueue ?? false});
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
