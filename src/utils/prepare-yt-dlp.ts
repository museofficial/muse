import Config from '../services/config.js';
import {getExecutable, getYtDlpVersion, updateYtDlp} from './yt-dlp.js';

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : 'unknown error';

const logUnavailableVersion = (error: unknown) => {
  console.warn(`YT_DLP_VERSION=unavailable (${getExecutable()}: ${getErrorMessage(error)})`);
};

export default async function prepareYtDlp(config: Config): Promise<void> {
  if (!config.YT_DLP_AUTO_UPDATE) {
    try {
      console.log(`YT_DLP_VERSION=${await getYtDlpVersion()} (${getExecutable()})`);
    } catch (error: unknown) {
      logUnavailableVersion(error);
    }

    return;
  }

  console.log(`YT_DLP_AUTO_UPDATE=true (${getExecutable()})`);

  const updateResult = await updateYtDlp();
  if (updateResult.error) {
    console.warn(`yt-dlp update warning: ${updateResult.error}`);
  }

  if (!updateResult.afterVersion) {
    console.warn('YT_DLP_VERSION=unavailable after auto-update');
    return;
  }

  if (updateResult.updated && updateResult.beforeVersion) {
    console.log(`YT_DLP_VERSION=${updateResult.afterVersion} (updated from ${updateResult.beforeVersion})`);
    return;
  }

  if (!updateResult.updateSucceeded) {
    console.log(`YT_DLP_VERSION=${updateResult.afterVersion} (update failed; continuing with installed version)`);
    return;
  }

  console.log(`YT_DLP_VERSION=${updateResult.afterVersion} (already current)`);
}
