import got from 'got';

const getYouTubeSuggestionsFor = async (query: string): Promise<string[]> => {
  const [_, suggestions] = await got('https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=', {
    searchParams: {
      client: 'firefox',
      ds: 'yt',
      q: query,
    },
  }).json<[string, string[]]>();

  return suggestions;
};

export default getYouTubeSuggestionsFor;
