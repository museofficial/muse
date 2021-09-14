import {TextChannel, Message, MessageReaction} from 'discord.js';
import delay from 'delay';

const INITAL_DELAY = 500;
const PERIOD = 500;

export default class {
  public isStopped = true;
  private readonly channel: TextChannel;
  private readonly text: string;
  private msg!: Message;

  constructor(channel: TextChannel, text = 'cows! count \'em') {
    this.channel = channel;
    this.text = text;
  }

  async start(): Promise<void> {
    this.msg = await this.channel.send(this.text);

    const icons = ['🐮', '🐴', '🐄'];

    const reactions: MessageReaction[] = [];

    let i = 0;
    let isRemoving = false;

    this.isStopped = false;

    (async () => {
      await delay(INITAL_DELAY);

      while (!this.isStopped) {
        if (reactions.length === icons.length) {
          isRemoving = true;
        }

        // eslint-disable-next-line no-await-in-loop
        await delay(PERIOD);

        if (isRemoving) {
          const reactionToRemove = reactions.shift();

          if (reactionToRemove) {
            // eslint-disable-next-line no-await-in-loop
            await reactionToRemove.users.remove(this.msg.client.user!.id);
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

  async stop(str = 'u betcha'): Promise<Message> {
    const wasAlreadyStopped = this.isStopped;

    this.isStopped = true;

    const editPromise = str ? this.msg.edit(str) : null;
    const reactPromise = str && !wasAlreadyStopped ? (async () => {
      await this.msg.fetch();
      await Promise.all(this.msg.reactions.cache.map(async react => {
        if (react.me) {
          await react.users.remove(this.msg.client.user!.id);
        }
      }));
    })() : null;

    await Promise.all([editPromise, reactPromise]);

    return this.msg;
  }
}
