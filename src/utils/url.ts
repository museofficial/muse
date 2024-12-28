import { URL } from 'url';

export const cleanUrl = (url: string) => {
  try {
    // Clean URL
    const u = new URL(url);

    for (const [name] of u.searchParams) {
      if (name !== 'v') {
        u.searchParams.delete(name);
      }
    }

    return u.toString();
     // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_: unknown) {
    return url;
  }
};
