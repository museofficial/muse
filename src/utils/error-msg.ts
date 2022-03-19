export default (error?: string | Error): string => {
  let str = '🚫 Unbekannter Fehler!';

  if (error) {
    if (typeof error === 'string') {
      str = `🚫 ${error}`;
    } else if (error instanceof Error) {
      str = `🚫 ${error.message}`;
    }
  }

  return str;
};
