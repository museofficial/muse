import {TextChannel, Message, MessageReaction} from 'discord.js';
import delay from 'delay';

const INITAL_DELAY = 500;
const PERIOD = 500;

export default class {
  public isStopped = true;
  private readonly channel: TextChannel;
  private readonly text: string;
  private msg!: Message;

  constructor(channel: TextChannel, text = 'Starting...') {
    this.channel = channel;
    this.text = text;
  }

  async start(): Promise<void> {
    this.msg = await this.channel.send(this.text);
    this.isStopped = false;
  }

  async stop(str = 'Stopping...'): Promise<Message> {
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
