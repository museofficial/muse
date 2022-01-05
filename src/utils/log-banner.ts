import {makeLines} from 'nodesplash';
import metadata from '../../package.json';

const logBanner = () => {
  console.log(makeLines({
    user: 'codetheweb',
    repository: 'muse',
    version: metadata.version,
    paypalUser: 'codetheweb',
    githubSponsor: 'codetheweb',
    madeByPrefix: 'Made with 🎶 by ',
  }).join('\n'));
  console.log('\n');
};

export default logBanner;
