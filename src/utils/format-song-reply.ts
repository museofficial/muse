import {truncate} from './string.js';

/** Preserve the command result around a title that may itself be a long stream URL. */
const formatSongReply = (title: string, render: (title: string) => string): string =>
  render(truncate(title, 2000 - render('').length));

export default formatSongReply;
