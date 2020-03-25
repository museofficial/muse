declare module 'ytsr' {
  interface VideoResult {
    title: string;
    duration: string;
    link: string;
    live: boolean;
    type: string;
  }

  interface SearchResult {
    items: VideoResult[];
  }

  export default function (search: string, options: object): Promise<SearchResult>;
}

declare module 'array-shuffle' {
  export default function <T>(arr: T[]): T[];
}
