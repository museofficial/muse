import {APIApplicationCommandOptionChoice} from 'discord-api-types/v10';
import SpotifyWebApi from 'spotify-web-api-node';
import getYouTubeSuggestionsFor from './get-youtube-suggestions-for.js';

const filterDuplicates = <T extends {name: string}>(items: T[]) => {
  const results: T[] = [];

  for (const item of items) {
    if (!results.some(result => result.name === item.name)) {
      results.push(item);
    }
  }

  return results;
};

const getYouTubeAndSpotifySuggestionsFor = async (query: string, spotify: SpotifyWebApi, limit = 10): Promise<APIApplicationCommandOptionChoice[]> => {
  const [youtubeSuggestions, spotifyResults] = await Promise.all([
    getYouTubeSuggestionsFor(query),
    spotify.search(query, ['track', 'album'], {limit: 5}),
  ]);

  const totalYouTubeResults = youtubeSuggestions.length;

  const spotifyAlbums = filterDuplicates(spotifyResults.body.albums?.items ?? []);
  const spotifyTracks = filterDuplicates(spotifyResults.body.tracks?.items ?? []);

  const totalSpotifyResults = spotifyAlbums.length + spotifyTracks.length;

  // Number of results for each source should be roughly the same.
  // If we don't have enough Spotify suggestions, prioritize YouTube results.
  const maxSpotifySuggestions = Math.floor(limit / 2);
  const numOfSpotifySuggestions = Math.min(maxSpotifySuggestions, totalSpotifyResults);

  const maxYouTubeSuggestions = limit - numOfSpotifySuggestions;
  const numOfYouTubeSuggestions = Math.min(maxYouTubeSuggestions, totalYouTubeResults);

  const suggestions: APIApplicationCommandOptionChoice[] = [];

  suggestions.push(
    ...youtubeSuggestions
      .slice(0, numOfYouTubeSuggestions)
      .map(suggestion => ({
        name: `YouTube: ${suggestion}`,
        value: suggestion,
      }),
      ));

  const maxSpotifyAlbums = Math.floor(numOfSpotifySuggestions / 2);
  const numOfSpotifyAlbums = Math.min(maxSpotifyAlbums, spotifyResults.body.albums?.items.length ?? 0);
  const maxSpotifyTracks = numOfSpotifySuggestions - numOfSpotifyAlbums;

  suggestions.push(
    ...spotifyAlbums.slice(0, maxSpotifyAlbums).map(album => ({
      name: `Spotify: 💿 ${album.name}${album.artists.length > 0 ? ` - ${album.artists[0].name}` : ''}`,
      value: `spotify:album:${album.id}`,
    })),
  );

  suggestions.push(
    ...spotifyTracks.slice(0, maxSpotifyTracks).map(track => ({
      name: `Spotify: 🎵 ${track.name}${track.artists.length > 0 ? ` - ${track.artists[0].name}` : ''}`,
      value: `spotify:track:${track.id}`,
    })),
  );

  return suggestions;
};

export default getYouTubeAndSpotifySuggestionsFor;
