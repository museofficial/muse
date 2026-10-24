import 'reflect-metadata';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {APIEmbed, EmbedBuilder} from 'discord.js';

const mocks = vi.hoisted(() => ({settings: vi.fn()}));
vi.mock('../src/utils/get-guild-settings.js', () => ({getGuildSettings: mocks.settings}));
vi.mock('../src/utils/channels.js', () => ({
  getMemberVoiceChannel: () => [{id: 'voice-channel'}],
  getMostPopularVoiceChannel: () => [{id: 'voice-channel'}],
}));
vi.mock('fluent-ffmpeg', () => ({default: vi.fn(() => ({
  ffprobe: (callback: (error: null, data: object) => void) => callback(null, {}),
}))}));

import Player, {MediaSource, QueuedSong, STATUS} from '../src/services/player.js';
import GetSongs from '../src/services/get-songs.js';
import AddQueryToQueue from '../src/services/add-query-to-queue.js';
import Move from '../src/commands/move.js';
import {buildQueueEmbed, buildPlayingMessageEmbed} from '../src/utils/build-embed.js';

const streamUrl = 'https://radio.example/live.m3u8?token=' + 'x'.repeat(5000);
const makeSong = (overrides: Partial<QueuedSong> = {}): QueuedSong => ({
  title: 'Song', artist: 'Artist', url: '12345678901', length: 120, offset: 0,
  playlist: null, isLive: false, thumbnailUrl: null, source: MediaSource.Youtube,
  requestedBy: 'requester', addedInChannelId: 'channel', ...overrides,
});
const makePlayerView = (current: QueuedSong, upcoming: QueuedSong[] = []) => ({
  status: STATUS.PLAYING, getCurrent: () => current, getQueue: () => upcoming,
  queueSize: () => upcoming.length, getPosition: () => 0, getVolume: () => 100,
});
const expectValidEmbed = (builder: EmbedBuilder): APIEmbed => {
  const embed = builder.toJSON();
  expect(embed.description!.length).toBeLessThanOrEqual(4096);
  expect(embed.footer!.text.length).toBeLessThanOrEqual(2048);
  const fieldLength = (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0);
  const totalLength = (embed.title?.length ?? 0) + (embed.description?.length ?? 0)
    + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0) + fieldLength;
  expect(totalLength).toBeLessThanOrEqual(6000);
  return embed;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({playlistLimit: 20, queueAddResponseEphemeral: false, defaultQueuePageSize: 10});
});

describe('playback embed output limits', () => {
  it.each([MediaSource.Youtube, MediaSource.SoundCloud, MediaSource.HLS])('bounds long current and upcoming metadata for source %s without changing playable URLs', source => {
    const song = makeSong({
      source, title: 'title'.repeat(1000), artist: 'artist'.repeat(1000),
      url: source === MediaSource.Youtube ? '12345678901' : streamUrl,
      playlist: {title: 'playlist'.repeat(1000), source: 'playlist-url'},
      isLive: source === MediaSource.HLS,
    });
    const original = structuredClone(song);
    const player = makePlayerView(song, [song]);

    const playing = expectValidEmbed(buildPlayingMessageEmbed(player as never));
    const queue = expectValidEmbed(buildQueueEmbed(player as never, 1, 10));

    expect(playing.description).toContain('Requested by: <@requester>');
    expect(queue.description).toContain('**Up next:**');
    expect(queue.description).toContain('`1.`');
    expect(song).toEqual(original);
    if (source !== MediaSource.Youtube) {
      expect(playing.description).not.toContain(streamUrl);
      expect(queue.description).not.toContain(streamUrl);
    }
  });

  it('reserves the aggregate embed budget for a full queue and long source footer', () => {
    const current = makeSong({artist: 'a'.repeat(2039)});
    const upcoming = Array.from({length: 30}, (_, index) => makeSong({
      source: MediaSource.SoundCloud, title: 'x'.repeat(100),
      url: `https://soundcloud.com/artist/${'long-track-slug-'.repeat(15)}${index}`,
    }));
    const player = makePlayerView(current, upcoming);

    const embed = expectValidEmbed(buildQueueEmbed(player as never, 1, 30));

    expect(embed.description).toContain('use a smaller page-size');
    expect(embed.footer!.text).toMatch(/^Source: a/);
  });

  it.each([MediaSource.Youtube, MediaSource.SoundCloud, MediaSource.HLS])('preserves normal labels and links for source %s', source => {
    const url = source === MediaSource.Youtube ? '12345678901'
      : source === MediaSource.SoundCloud ? 'https://soundcloud.com/artist/track' : 'https://radio.example/live';
    const song = makeSong({source, url});
    const player = makePlayerView(song);
    const expectedLink = source === MediaSource.Youtube ? 'https://www.youtube.com/watch?v=12345678901' : url;

    const playing = expectValidEmbed(buildPlayingMessageEmbed(player as never));
    const queue = expectValidEmbed(buildQueueEmbed(player as never, 1, 10));

    expect(playing.description).toContain(`**[Song](${expectedLink})**`);
    expect(queue.description).toContain(`**[Song](${expectedLink})**`);
    expect(playing.footer!.text).toBe('Source: Artist');
    expect(queue.footer!.text).toBe('Source: Artist ');
  });
});

const makeQueueRequest = (ephemeral: boolean, existingSong: boolean) => {
  const player = new Player({} as never, 'guild');
  player.voiceConnection = {state: {status: 'ready'}} as never;
  player.status = existingSong ? STATUS.PAUSED : STATUS.IDLE;
  if (existingSong) {
    player.add(makeSong());
  }

  vi.spyOn(player, 'play').mockImplementation(async () => { player.status = STATUS.PLAYING; });
  const updater = vi.spyOn(player, 'setPlayingMessageUpdater');
  mocks.settings.mockResolvedValue({playlistLimit: 20, queueAddResponseEphemeral: ephemeral, defaultQueuePageSize: 10});
  const message = {
    id: 'message', edit: vi.fn().mockResolvedValue(undefined), react: vi.fn().mockResolvedValue(undefined),
    reactions: {removeAll: vi.fn().mockResolvedValue(undefined)},
  };
  const interaction = {
    guild: {id: 'guild'}, member: {user: {id: 'requester'}}, channel: {id: 'channel'},
    deferReply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(message),
  };
  const service = new AddQueryToQueue(new GetSongs({} as never), {get: () => player} as never, {ENABLE_SPONSORBLOCK: false} as never, {} as never);
  const request = () => service.addToQueue({
    query: streamUrl, addToFrontOfQueue: false, shuffleAdditions: false,
    shouldSplitChapters: false, skipCurrentTrack: false, interaction: interaction as never,
  });
  return {player, interaction, message, request, updater};
};

describe('queue acknowledgment output limits', () => {
  it('bounds the plain acknowledgment after adding a long stream URL to an existing queue', async () => {
    const {player, interaction, request} = makeQueueRequest(false, true);

    await request();

    const content = interaction.editReply.mock.calls[0][0] as string;
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toMatch(/^u betcha, \*\*https:\/\/radio\.example\//);
    expect(content).toMatch(/\*\* added to the queue$/);
    expect(player.getQueue()[0].url).toBe(streamUrl);
  });

  it.each([false, true])('publishes a bounded initial and finished response for a long stream URL (ephemeral=%s)', async ephemeral => {
    const {player, interaction, message, request, updater} = makeQueueRequest(ephemeral, false);

    await request();

    const initial = interaction.editReply.mock.calls[0][0];
    expect(initial.content.length).toBeLessThanOrEqual(2000);
    expectValidEmbed(initial.embeds[0]);
    expect(player.getCurrent()!.url).toBe(streamUrl);
    await updater.mock.calls[0][0]('finished');
    expect(ephemeral ? interaction.editReply : message.edit).toHaveBeenLastCalledWith({content: initial.content, embeds: []});
  });

  it('bounds /move confirmation without changing the moved entry', async () => {
    const song = makeSong({title: streamUrl, url: streamUrl, source: MediaSource.HLS});
    const interaction = {guild: {id: 'guild'}, options: {getInteger: () => 1}, reply: vi.fn()};

    await new Move({get: () => ({move: () => song})} as never).execute(interaction as never);

    const content = interaction.reply.mock.calls[0][0] as string;
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toMatch(/^moved \*\*https:\/\/radio\.example\//);
    expect(content).toMatch(/\*\* to position \*\*1\*\*$/);
    expect(song.url).toBe(streamUrl);
    expect(song.title).toBe(streamUrl);
  });
});
