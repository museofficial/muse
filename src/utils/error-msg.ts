export default (error?: string | Error): string => {
  let str = 'unknown error';

  if (error) {
    if (typeof error === 'string') {
      str = `🚫 ope: ${error}`;
    } else if (error instanceof Error) {
      str = `🚫 ope: ${error.message}`;
    }
  }

  return str;
};
