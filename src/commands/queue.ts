import {Message, MessageEmbed} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import QueueManager from '../managers/queue';
import PlayerManager from '../managers/player';
import {STATUS} from '../services/player';
import Command from '.';
import getProgressBar from '../utils/get-progress-bar';
import errorMsg from '../utils/error-msg';
import {prettyTime} from '../utils/time';

const PAGE_SIZE = 10;

@injectable()
export default class implements Command {
  public name = 'queue';
  public aliases = ['q'];
  public examples = [
    ['queue', 'shows current queue']
  ];

  private readonly queueManager: QueueManager;
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Queue) queueManager: QueueManager, @inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.queueManager = queueManager;
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, args: string []): Promise<void> {
    const queue = this.queueManager.get(msg.guild!.id);
    const player = this.playerManager.get(msg.guild!.id);

    const currentlyPlaying = queue.getCurrent();

    if (currentlyPlaying) {
      const queueSize = queue.size();
      const queuePage = args[0] ? parseInt(args[0], 10) : 1;

      if (queuePage * PAGE_SIZE > queueSize && queuePage > Math.ceil((queueSize + 1) / PAGE_SIZE)) {
        await msg.channel.send(errorMsg('the queue isn\'t that big'));
        return;
      }

      const embed = new MessageEmbed();

      embed.setTitle(currentlyPlaying.title);
      embed.setURL(`https://www.youtube.com/watch?v=${currentlyPlaying.url}`);
      embed.setFooter(`Source: ${currentlyPlaying.artist}`);

      let description = player.status === STATUS.PLAYING ? '⏹️' : '▶️';
      description += ' ';
      description += getProgressBar(20, player.getPosition() / currentlyPlaying.length);
      description += ' ';
      description += `\`[${prettyTime(player.getPosition())}/${prettyTime(currentlyPlaying.length)}]\``;
      description += ' 🔉';
      description += queue.isEmpty() ? '' : '\n\n**Next up:**';

      embed.setDescription(description);

      const queuePageBegin = (queuePage - 1) * PAGE_SIZE;
      const queuePageEnd = queuePageBegin + PAGE_SIZE;

      queue.get().slice(queuePageBegin, queuePageEnd).forEach((song, i) => {
        embed.addField(`${(i + 1 + queuePageBegin).toString()}/${queueSize.toString()}`, song.title, false);
      });

      await msg.channel.send(embed);
    } else {
      await msg.channel.send('queue empty');
    }
  }
}
