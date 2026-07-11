import type {SongMetadata} from '../services/player.js';

const IGNORED_MATCH_TOKENS = new Set([
  '4k',
  'audio',
  'channel',
  'hd',
  'lyrics',
  'lyric',
  'music',
  'official',
  'records',
  'recordings',
  'topic',
  'vevo',
  'video',
  'visualizer',
]);

const UNWANTED_VERSION_MARKERS = [
  /\bcover\b/i,
  /\bextended\b/i,
  /\binstrumental\b/i,
  /\bkaraoke\b/i,
  /\blive\b/i,
  /\bnightcore\b/i,
  /\bremix\b/i,
  /\bslowed\b/i,
  /\bsped\s+up\b/i,
];

const GENERIC_CHANNEL_MARKER = /\b(?:channel|entertainment|media|official|records?|recordings?|tv)\b/i;

const cleanVideoTitle = (title: string) => title
  .replace(/\s*[[(][^\])]*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er)[^\])]*[\])]/gi, ' ')
  .replace(/\b(?:official\s+)?music\s+video\b/gi, ' ')
  .replace(/\b(?:official\s+)?(?:audio|lyrics?(?:\s+video)?|visuali[sz]er)\b/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const matchTokens = (value: string) => Array.from(new Set(value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(/\s+/)
  .filter(token => token && !IGNORED_MATCH_TOKENS.has(token))));

const cleanArtist = (artist: string) => artist
  .replace(/\s+-\s+Topic$/i, '')
  .replace(/VEVO$/i, '')
  .trim();

const getReliableArtist = (song: SongMetadata) => {
  const artist = cleanArtist(song.artist);
  return artist && !GENERIC_CHANNEL_MARKER.test(artist) ? artist : '';
};

const requiredTokenOverlap = (tokens: string[]) => tokens.length === 1
  ? 1
  : Math.max(2, Math.ceil(tokens.length * 0.6));

const countTokenOverlap = (tokens: string[], candidateTokens: Set<string>) => tokens
  .filter(token => candidateTokens.has(token))
  .length;

const hasUnexpectedVersionMarker = (originalTitle: string, candidateTitle: string) => UNWANTED_VERSION_MARKERS
  .some(pattern => pattern.test(candidateTitle) && !pattern.test(originalTitle));

const isDurationClose = (originalLength: number, candidateLength: number) => {
  if (originalLength <= 0 || candidateLength <= 0) {
    return false;
  }

  const tolerance = Math.max(30, originalLength * 0.25);
  return Math.abs(originalLength - candidateLength) <= tolerance;
};

const hasMatchingTitle = (original: SongMetadata, candidate: SongMetadata) => {
  const originalTokens = matchTokens(cleanVideoTitle(original.title));
  if (originalTokens.length === 0) {
    return false;
  }

  const candidateTokens = new Set(matchTokens(`${candidate.title} ${candidate.artist}`));
  if (countTokenOverlap(originalTokens, candidateTokens) < requiredTokenOverlap(originalTokens)) {
    return false;
  }

  const artistTokens = matchTokens(getReliableArtist(original));
  const originalTitleTokens = new Set(originalTokens);
  const titleIncludesArtist = artistTokens.length > 0
    && countTokenOverlap(artistTokens, originalTitleTokens) >= requiredTokenOverlap(artistTokens);

  if (!titleIncludesArtist && artistTokens.length > 0) {
    return countTokenOverlap(artistTokens, candidateTokens) >= requiredTokenOverlap(artistTokens);
  }

  return originalTokens.length > 2 || artistTokens.length > 0;
};

const preferenceScore = (original: SongMetadata, candidate: SongMetadata) => {
  let score = 0;
  if (/\s-\sTopic$/i.test(candidate.artist)) {
    score += 4;
  }

  if (/\b(?:official\s+)?audio\b|\blyrics?\b/i.test(candidate.title)) {
    score += 2;
  }

  const durationTolerance = Math.max(30, original.length * 0.25);
  score += 1 - (Math.abs(original.length - candidate.length) / durationTolerance);
  return score;
};

export const buildAudioFallbackQuery = (song: SongMetadata) => {
  const title = cleanVideoTitle(song.title);
  if (!title) {
    return '';
  }

  const titleTokens = new Set(matchTokens(title));
  const artist = getReliableArtist(song);
  const artistTokens = matchTokens(artist);
  const titleIncludesArtist = artistTokens.length > 0
    && countTokenOverlap(artistTokens, titleTokens) >= requiredTokenOverlap(artistTokens);

  if (artistTokens.length === 0 && titleTokens.size <= 2) {
    return '';
  }

  return `${titleIncludesArtist || !artist ? '' : `${artist} `}${title} audio Topic`;
};

export const rankAudioFallbackCandidates = (original: SongMetadata, candidates: SongMetadata[]) => candidates
  .map((candidate, index) => ({candidate, index}))
  .filter(({candidate}) => (
    candidate.url !== original.url
    && !candidate.isLive
    && isDurationClose(original.length, candidate.length)
    && !hasUnexpectedVersionMarker(cleanVideoTitle(original.title), candidate.title)
    && hasMatchingTitle(original, candidate)
  ))
  .sort((left, right) => (
    preferenceScore(original, right.candidate) - preferenceScore(original, left.candidate)
    || left.index - right.index
  ))
  .map(({candidate}) => candidate);
