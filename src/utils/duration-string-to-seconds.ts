import parse from 'parse-duration';

/**
 * Parse duration strings to seconds.
 * @param str any common duration format, like 1m or 1hr 30s. If the input is a number it's assumed to be in seconds.
 * @returns seconds
 */
const durationStringToSeconds = (str: string) => {
  let seconds;
  const isInputSeconds = Boolean(/\d+$/.exec(str));

  if (isInputSeconds) {
    seconds = Number.parseInt(str, 10);
  } else {
    const parsed = parse(str);
    seconds = parsed ? parsed / 1000 : 0;
  }

  return seconds;
};

export default durationStringToSeconds;
