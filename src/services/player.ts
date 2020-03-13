import {inject, injectable} from 'inversify';
import {VoiceConnection, VoiceChannel} from 'discord.js';
import {TYPES} from '../types';
import Queue from './queue';
import getYouTubeStream from '../utils/get-youtube-stream';

export enum Status {
  Playing,
  Paused,
  Disconnected
}

export interface GuildPlayer {
  status: Status;
  voiceConnection: VoiceConnection | null;
}

@injectable()
export default class {
  private readonly guildPlayers = new Map<string, GuildPlayer>();
  private readonly queue: Queue;

  constructor(@inject(TYPES.Services.Queue) queue: Queue) {
    this.queue = queue;
  }

  async connect(guildId: string, channel: VoiceChannel): Promise<void> {
    this.initGuild(guildId);

    const guildPlayer = this.guildPlayers.get(guildId);

    const conn = await channel.join();

    guildPlayer!.voiceConnection = conn;

    this.guildPlayers.set(guildId, guildPlayer!);
  }

  disconnect(guildId: string): void {
    this.initGuild(guildId);

    const guildPlayer = this.guildPlayers.get(guildId);

    if (guildPlayer?.voiceConnection) {
      guildPlayer.voiceConnection.disconnect();
    }
  }

  async play(guildId: string): Promise<void> {
    const guildPlayer = this.get(guildId);
    if (guildPlayer.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    if (guildPlayer.status === Status.Playing) {
      // Already playing, return
      return;
    }

    const songs = this.queue.get(guildId);

    if (songs.length === 0) {
      throw new Error('Queue empty.');
    }

    const song = songs[0];

    const stream = await getYouTubeStream(song.url);

    this.get(guildId).voiceConnection!.play(stream, {type: 'webm/opus'});

    guildPlayer.status = Status.Playing;

    this.guildPlayers.set(guildId, guildPlayer);
  }

  get(guildId: string): GuildPlayer {
    this.initGuild(guildId);

    return this.guildPlayers.get(guildId) as GuildPlayer;
  }

  private initGuild(guildId: string): void {
    if (!this.guildPlayers.get(guildId)) {
      this.guildPlayers.set(guildId, {status: Status.Disconnected, voiceConnection: null});
    }
  }
}
