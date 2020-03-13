import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import Queue from '../services/queue';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'queue';
  public description = 'shows current queue';
  private readonly queue: Queue;

  constructor(@inject(TYPES.Services.Queue) queue: Queue) {
    this.queue = queue;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const queue = this.queue.get(msg.guild!.id);

    await msg.channel.send('`' + JSON.stringify(queue.slice(0, 10)) + '`');
  }
}
