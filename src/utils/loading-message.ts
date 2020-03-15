import {TextChannel, Message} from 'discord.js';
import delay from 'delay';

export default class {
  private readonly channel: TextChannel;
  private readonly text: string;
  private msg!: Message;
  private isStopped = false;

  constructor(channel: TextChannel, text: string) {
    this.channel = channel;
    this.text = text;
  }

  async start(): Promise<void> {
    this.msg = await this.channel.send(this.text);

    const period = 500;

    const icons = ['⚪', '🔵', '⚫'];

    const reactions = [];

    let i = 0;
    let isRemoving = false;
    (async () => {
      while (!this.isStopped) {
        if (reactions.length === icons.length) {
          isRemoving = true;
        }

        // eslint-disable-next-line no-await-in-loop
        await delay(period);

        if (isRemoving) {
          const reactionToRemove = reactions.shift();

          if (reactionToRemove) {
            // eslint-disable-next-line no-await-in-loop
            await reactionToRemove.remove();
          } else {
            isRemoving = false;
          }
        } else {
          if (!this.isStopped) {
            // eslint-disable-next-line no-await-in-loop
            reactions.push(await this.msg.react(icons[i % icons.length]));
          }

          i++;
        }
      }
    })();
  }

  async stop(str?: string): Promise<Message> {
    this.isStopped = true;

    if (str) {
      await Promise.all([this.msg.reactions.removeAll(), this.msg.edit(str)]);
    } else {
      await this.msg.reactions.removeAll();
    }

    return this.msg;
  }
}
