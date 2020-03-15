import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import Queue from '../services/queue';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'clear';
  public description = 'clears all songs in queue (except currently playing)';
  private readonly queue: Queue;

  constructor(@inject(TYPES.Services.Queue) queue: Queue) {
    this.queue = queue;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    this.queue.clear(msg.guild!.id);

    await msg.channel.send('cleared');
  }
}
