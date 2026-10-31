// The TypeScript build only emits compiled .ts files, so this copies the bundled intro/outro clips into dist/.
import fs from 'fs';
import path from 'path';

const source = path.join('src', 'sounds');
const target = path.join('dist', 'sounds');

fs.cpSync(source, target, {recursive: true});
