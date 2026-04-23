import {execa} from 'execa';

interface YtDlpMediaDownload {
  readonly url?: string;
  readonly protocol?: string;
  readonly ext?: string;
  readonly acodec?: string;
  readonly vcodec?: string;
  readonly http_headers?: Record<string, string>;
}

interface YtDlpResponse extends YtDlpMediaDownload {
  readonly is_live?: boolean;
  readonly live_status?: string;
  readonly requested_downloads?: readonly YtDlpMediaDownload[];
}

export interface YtDlpMediaSource {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly isLive: boolean;
}

const getExecutable = () => {
  const configuredPath = process.env.YT_DLP_PATH?.trim();

  return configuredPath === '' ? 'yt-dlp' : (configuredPath ?? 'yt-dlp');
};

const normalizeHeaders = (headers?: Record<string, string>) => {
  const normalizedEntries = Object.entries(headers ?? {})
    .filter(([, value]) => value !== undefined && value !== '');

  return Object.fromEntries(normalizedEntries);
};

const isExecaError = (error: unknown): error is {stderr?: string; shortMessage?: string} => (
  typeof error === 'object'
  && error !== null
  && ('stderr' in error || 'shortMessage' in error)
);

const toYouTubeWatchUrl = (videoIdOrUrl: string) => videoIdOrUrl.length === 11
  ? `https://www.youtube.com/watch?v=${videoIdOrUrl}`
  : videoIdOrUrl;

export const getYouTubeMediaSource = async (videoIdOrUrl: string): Promise<YtDlpMediaSource> => {
  try {
    const {stdout} = await execa(getExecutable(), [
      '--dump-single-json',
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '--no-cache-dir',
      '-f',
      'bestaudio/best',
      '-S',
      'proto:https',
      '--extractor-args',
      'youtube:player_client=android_vr,default,-ios',
      toYouTubeWatchUrl(videoIdOrUrl),
    ]);

    const response = JSON.parse(stdout) as YtDlpResponse;
    const download = response.requested_downloads?.at(0) ?? response;

    if (!download.url) {
      throw new Error('yt-dlp did not return a playable media URL.');
    }

    return {
      url: download.url,
      headers: normalizeHeaders(download.http_headers ?? response.http_headers),
      isLive: Boolean(response.is_live ?? (response.live_status === 'is_live')),
    };
  } catch (error: unknown) {
    if (isExecaError(error)) {
      const detail = error.stderr?.trim() ?? error.shortMessage ?? 'Unknown yt-dlp error';
      throw new Error(`yt-dlp failed to extract media: ${detail}`);
    }

    if (error instanceof SyntaxError) {
      throw new Error('yt-dlp returned an invalid response.');
    }

    throw error;
  }
};
