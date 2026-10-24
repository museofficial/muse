import {truncate} from './string.js';

/** Preserve the command result around a title that may itself be a long stream URL. */
const formatSongReply = (title: string, prefix: string, suffix: string): string =>
  `${prefix}${truncate(title, 2000 - prefix.length - suffix.length)}${suffix}`;

export default formatSongReply;
