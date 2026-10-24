export default (width: number, progress: number): string => {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const dotPosition = Math.min(width - 1, Math.floor(width * clampedProgress));
  const hairSpace = '\u200A';
  const wordJoiner = '\u2060';

  // Striking through hair spaces produces a continuous, narrow Discord rail
  // without exposing block characters. Word joiners ensure Discord's Markdown
  // parser treats the otherwise-whitespace rail as formattable content.
  const buildRail = (length: number) => length === 0
    ? ''
    : `~~${wordJoiner}${hairSpace.repeat(length)}${wordJoiner}~~`;

  return buildRail(dotPosition)
    + '🔘'
    + buildRail(width - dotPosition - 1);
};
