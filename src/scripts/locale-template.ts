import path from 'path';
import {writeLocaleTemplate} from '../i18n/custom.js';
import {DATA_DIR} from '../services/config.js';

(async () => {
  const [code = ''] = process.argv.slice(2);

  try {
    const filePath = await writeLocaleTemplate(code, path.join(DATA_DIR, 'locales'));
    console.log(`Created ${filePath}\nSet "name", translate the lines you want and delete the rest, then restart Muse.`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
})();
