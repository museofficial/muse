import {t} from '../i18n/index.js';

export default (error?: string | Error, locale?: string | null): string => {
  let str = t(locale, 'error.unknown');

  if (error) {
    if (typeof error === 'string') {
      str = t(locale, 'error.prefix', {message: error});
    } else if (error instanceof Error) {
      str = t(locale, 'error.prefix', {message: error.message});
    }
  }

  return str;
};
