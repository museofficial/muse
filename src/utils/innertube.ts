import Innertube, {UniversalCache} from 'youtubei.js';

export const innertube = await Innertube.create({
  cache: new UniversalCache(false),
});
