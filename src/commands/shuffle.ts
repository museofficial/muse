import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import Queue from '../services/queue';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'shuffle';
  public description = 'shuffle current queue';
  private readonly queue: Queue;

  constructor(@inject(TYPES.Services.Queue) queue: Queue) {
    this.queue = queue;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const queue = this.queue.get(msg.guild!.id);

    if (queue.length <= 2) {
      await msg.channel.send('error: not enough songs to shuffle');
      return;
    }

    this.queue.shuffle(msg.guild!.id);

    await msg.channel.send('`' + JSON.stringify(this.queue.get(msg.guild!.id).slice(0, 10)) + '`');
  }
}
