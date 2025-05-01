import Innertube, {UniversalCache} from 'youtubei.js';

export const innertube = async () => Innertube.create({
  cache: new UniversalCache(false),
});
