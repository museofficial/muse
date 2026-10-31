// The TypeScript build only emits compiled .ts files, so this copies the bundled JSON language packs into dist/.
import fs from 'fs';
import path from 'path';

const source = path.join('src', 'i18n', 'locales');
const target = path.join('dist', 'i18n', 'locales');

fs.mkdirSync(target, {recursive: true});
for (const fileName of fs.readdirSync(source).filter(name => name.endsWith('.json'))) {
  fs.copyFileSync(path.join(source, fileName), path.join(target, fileName));
}
