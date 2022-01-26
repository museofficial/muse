import {AutocompleteInteraction, CommandInteraction, GuildMember} from 'discord.js';
import {URL} from 'url';
import {Except} from 'type-fest';
import {SlashCommandBuilder} from '@discordjs/builders';
import shuffle from 'array-shuffle';
import {inject, injectable} from 'inversify';
import Spotify from 'spotify-web-api-node';
import Command from '.';
import {TYPES} from '../types.js';
import {QueuedSong, STATUS} from '../services/player.js';
import PlayerManager from '../managers/player.js';
import {getMostPopularVoiceChannel, getMemberVoiceChannel} from '../utils/channels.js';
import GetSongs from '../services/get-songs.js';
import {prisma} from '../utils/db.js';
import ThirdParty from '../services/third-party.js';
import getYouTubeAndSpotifySuggestionsFor from '../utils/get-youtube-and-spotify-suggestions-for.js';
import KeyValueCacheProvider from '../services/key-value-cache.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('play')
    // TODO: make sure verb tense is consistent between all command descriptions
    .setDescription('play a song or resume playback')
    .addStringOption(option => option
      .setName('query')
      .setDescription('YouTube URL, Spotify URL, or search query')
      .setAutocomplete(true))
    .addBooleanOption(option => option
      .setName('immediate')
      .setDescription('adds track to the front of the queue'))
    .addBooleanOption(option => option
      .setName('shuffle')
      .setDescription('shuffles the input if it\'s a playlist'));

  public requiresVC = true;

  private readonly playerManager: PlayerManager;
  private readonly getSongs: GetSongs;
  private readonly spotify: Spotify;
  private readonly cache: KeyValueCacheProvider;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager, @inject(TYPES.Services.GetSongs) getSongs: GetSongs, @inject(TYPES.ThirdParty) thirdParty: ThirdParty, @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider) {
    this.playerManager = playerManager;
    this.getSongs = getSongs;
    this.spotify = thirdParty.spotify;
    this.cache = cache;
  }

  // eslint-disable-next-line complexity
  public async execute(interaction: CommandInteraction): Promise<void> {
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);

    const settings = await prisma.setting.findUnique({where: {guildId: interaction.guild!.id}});

    if (!settings) {
      throw new Error('Could not find settings for guild');
    }

    const {playlistLimit} = settings;

    const player = this.playerManager.get(interaction.guild!.id);
    const wasPlayingSong = player.getCurrent() !== null;

    const query = interaction.options.getString('query');

    if (!query) {
      if (player.status === STATUS.PLAYING) {
        throw new Error('already playing, give me a song name');
      }

      // Must be resuming play
      if (!wasPlayingSong) {
        throw new Error('nothing to play');
      }

      await player.connect(targetVoiceChannel);
      await player.play();

      await interaction.reply({
        content: 'the stop-and-go light is now green',
        embeds: [buildPlayingMessageEmbed(player)],
      });

      return;
    }

    const addToFrontOfQueue = interaction.options.getBoolean('immediate');
    const shuffleAdditions = interaction.options.getBoolean('shuffle');

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

  public async handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    const query = interaction.options.getString('query')?.trim();

    if (!query || query.length === 0) {
      await interaction.respond([]);
      return;
    }

    try {
      // Don't return suggestions for URLs
      // eslint-disable-next-line no-new
      new URL(query);
      await interaction.respond([]);
      return;
    } catch {}

    const suggestions = await this.cache.wrap(
      getYouTubeAndSpotifySuggestionsFor,
      query,
      this.spotify,
      10,
      {
        expiresIn: ONE_HOUR_IN_SECONDS,
        key: `autocomplete:${query}`,
      });

    await interaction.respond(suggestions);
  }
}
