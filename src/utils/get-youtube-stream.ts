import {promises as fs, createReadStream, createWriteStream} from 'fs';
import {Readable, PassThrough} from 'stream';
import path from 'path';
import hasha from 'hasha';
import ytdl from 'ytdl-core';
import {CACHE_DIR} from './config';

const nextBestFormat = (formats: ytdl.videoFormat[]): ytdl.videoFormat => {
  formats = formats
    .filter(format => format.averageBitrate)
    .sort((a, b) => b.averageBitrate - a.averageBitrate);
  return formats.find(format => !format.bitrate) ?? formats[0];
};

// TODO: are some videos not available in webm/opus?
export default async (url: string): Promise<Readable> => {
  const hash = hasha(url);
  const cachedPath = path.join(CACHE_DIR, `${hash}.webm`);

  const info = await ytdl.getInfo(url);

  const {formats} = info;

  const filter = (format: ytdl.videoFormat): boolean => format.codecs === 'opus' && format.container === 'webm' && format.audioSampleRate !== undefined && parseInt(format.audioSampleRate, 10) === 48000;

  let format = formats.find(filter);

  if (!format) {
    format = nextBestFormat(info.formats);
  }

  try {
    // Test if file exists
    await fs.access(cachedPath);

    // If so, return cached stream
    return createReadStream(cachedPath);
  } catch (_) {
    // Not yet cached, must download
    const cacheTempPath = path.join('/tmp', `${hash}.webm`);
    const cacheStream = createWriteStream(cacheTempPath);

    const pass = new PassThrough();

    pass.pipe(cacheStream).on('finish', async () => {
      await fs.rename(cacheTempPath, cachedPath);
    });

    return ytdl.downloadFromInfo(info, {format}).pipe(pass);
  }
};
