import {injectable} from 'inversify';
import Queue from '../services/queue';

@injectable()
export default class {
  private readonly guildQueues: Map<string, Queue>;

  constructor() {
    this.guildQueues = new Map();
  }

  get(guildId: string): Queue {
    let queue = this.guildQueues.get(guildId);

    if (!queue) {
      queue = new Queue();

      this.guildQueues.set(guildId, queue);
    }

    return queue;
  }
}
