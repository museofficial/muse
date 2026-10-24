import {ApplicationCommandPermissionType as Type, ApplicationCommandType, Collection, PermissionFlagsBits as Bits, PermissionsBitField} from 'discord.js';
import {describe, expect, it, vi} from 'vitest';
import canUsePlaybackCommand from '../src/utils/can-use-playback-command.js';

const guildId = '100000000000000000';
const allChannels = '99999999999999999';
const overwrite = (type: Type, id: string, permission: boolean) => ({type, id, permission});
const everyone = (allow: boolean) => overwrite(Type.Role, guildId, allow);
const role = (allow: boolean, id = 'dj') => overwrite(Type.Role, id, allow);
const user = (allow: boolean, id = 'listener') => overwrite(Type.User, id, allow);
const channelRule = (allow: boolean, id = 'text') => overwrite(Type.Channel, id, allow);

const setup = (applicationPermissions = [] as ReturnType<typeof overwrite>[], commandPermissions = [] as ReturnType<typeof overwrite>[]) => {
  const command = {id: 'stop-command', name: 'stop', type: ApplicationCommandType.ChatInput, defaultMemberPermissions: null as PermissionsBitField | null};
  const permissions = new Collection([
    ['application', applicationPermissions],
    [command.id, commandPermissions],
  ]);
  const guild = {
    id: guildId,
    commands: {
      fetch: vi.fn().mockResolvedValue(new Collection([[command.id, command]])),
      permissions: {fetch: vi.fn().mockResolvedValue(permissions)},
    },
    members: {fetch: vi.fn()},
    channels: {fetch: vi.fn()},
    roles: {fetch: vi.fn().mockResolvedValue(new Collection())},
  };
  const member = {
    id: 'listener', guild,
    roles: {cache: new Collection([[guildId, {}], ['dj', {}], ['other-role', {}]])},
    permissions: new PermissionsBitField(),
  };
  const channel = {
    id: 'text', parentId: null as string | null,
    isTextBased: () => true,
    isThread: vi.fn(() => false),
    permissionsFor: vi.fn(() => new PermissionsBitField([Bits.ViewChannel, Bits.UseApplicationCommands])),
  };
  const application = {id: 'application', commands: {fetch: vi.fn().mockResolvedValue(new Collection())}};
  const message = {inGuild: () => true, guild, client: {application}, channelId: channel.id};
  guild.members.fetch.mockResolvedValue(member);
  guild.channels.fetch.mockResolvedValue(channel);
  const check = () => canUsePlaybackCommand(message as never, member.id, 'stop');
  return {application, channel, check, command, guild, member, message, permissions};
};

describe('reaction command authorization', () => {
  it('allows an unrestricted command after refreshing permissions and membership', async () => {
    const fixture = setup();
    expect(await fixture.check()).toBe(true);
    expect(fixture.guild.members.fetch).toHaveBeenCalledWith({user: 'listener', force: true});
    expect(fixture.guild.channels.fetch).toHaveBeenCalledWith('text', {force: true});
    expect(fixture.guild.roles.fetch).toHaveBeenCalledOnce();
    expect(fixture.guild.commands.permissions.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['application user denial', [user(false)], [], false],
    ['command user denial', [], [user(false)], false],
    ['application role denial', [role(false)], [], false],
    ['command role denial', [], [role(false)], false],
    ['everyone denial', [everyone(false)], [], false],
    ['role grant over everyone denial', [everyone(false), role(true)], [], true],
    ['user denial over role grant', [role(true)], [user(false)], false],
    ['user grant over role denial', [role(false)], [user(true)], true],
    ['one allowed role and one denied role', [role(false), role(true, 'other-role')], [], true],
    ['command replaces a matching user grant', [user(true)], [user(false)], false],
    ['command replaces a matching user denial', [user(false)], [user(true)], true],
    ['channel overwrite preserves application user denial', [user(false)], [channelRule(true)], false],
    ['unrelated user grant preserves everyone denial', [everyone(false)], [user(true, 'someone-else')], false],
    ['application channel denial', [channelRule(false)], [], false],
    ['command channel denial', [], [channelRule(false)], false],
    ['all channels denial', [channelRule(false, allChannels)], [], false],
    ['channel exception to all channels denial', [channelRule(false, allChannels)], [channelRule(true)], true],
    ['command replaces channel grant', [channelRule(true)], [channelRule(false)], false],
    ['user grant does not bypass channel denial', [channelRule(false)], [user(true)], false],
    ['unrelated channel change preserves channel denial', [channelRule(false)], [channelRule(true, 'elsewhere')], false],
  ] as const)('%s', async (_name, appRules, commandRules, allowed) => {
    expect(await setup([...appRules], [...commandRules]).check()).toBe(allowed);
  });

  it('retains default member requirements when application access is granted', async () => {
    const fixture = setup([role(true)], [channelRule(true)]);
    fixture.command.defaultMemberPermissions = new PermissionsBitField(Bits.ManageMessages);
    expect(await fixture.check()).toBe(false);
    fixture.channel.permissionsFor.mockReturnValue(new PermissionsBitField([Bits.ViewChannel, Bits.UseApplicationCommands, Bits.ManageMessages]));
    expect(await fixture.check()).toBe(true);
  });

  it('requires an explicit command grant for a command disabled by default', async () => {
    const fixture = setup([role(true)], [user(true, 'someone-else')]);
    fixture.command.defaultMemberPermissions = new PermissionsBitField(0n);
    expect(await fixture.check()).toBe(false);
    fixture.permissions.set(fixture.command.id, [role(true)]);
    expect(await fixture.check()).toBe(true);
  });

  it.each([Bits.ViewChannel, Bits.UseApplicationCommands])('requires channel permission %s even with a command grant', async missing => {
    const fixture = setup([], [user(true)]);
    fixture.channel.permissionsFor.mockReturnValue(new PermissionsBitField([Bits.ViewChannel, Bits.UseApplicationCommands]).remove(missing));
    expect(await fixture.check()).toBe(false);
  });

  it('honors the administrator bypass', async () => {
    const fixture = setup([everyone(false), channelRule(false)], [user(false)]);
    fixture.member.permissions = new PermissionsBitField(Bits.Administrator);
    fixture.channel.permissionsFor.mockReturnValue(fixture.member.permissions);
    fixture.command.defaultMemberPermissions = new PermissionsBitField(0n);
    expect(await fixture.check()).toBe(true);
  });

  it('uses parent channel command restrictions in threads', async () => {
    const fixture = setup([channelRule(false, 'parent')]);
    fixture.channel.isThread.mockReturnValue(true);
    fixture.channel.parentId = 'parent';
    expect(await fixture.check()).toBe(false);
    expect(fixture.guild.channels.fetch).toHaveBeenCalledWith('parent', {force: true});
    fixture.permissions.set(fixture.command.id, [channelRule(true, 'parent')]);
    expect(await fixture.check()).toBe(true);
  });

  it('supports global commands when no matching guild command exists', async () => {
    const fixture = setup([], [user(false)]);
    fixture.guild.commands.fetch.mockResolvedValue(new Collection());
    fixture.application.commands.fetch.mockResolvedValue(new Collection([[fixture.command.id, fixture.command]]));
    expect(await fixture.check()).toBe(false);
    fixture.permissions.set(fixture.command.id, []);
    expect(await fixture.check()).toBe(true);
  });

  it('prefers a guild command over a global command with the same name', async () => {
    const fixture = setup([], [user(false)]);
    fixture.application.commands.fetch.mockResolvedValue(new Collection([['global', {...fixture.command, id: 'global'}]]));
    expect(await fixture.check()).toBe(false);
    expect(fixture.application.commands.fetch).not.toHaveBeenCalled();
  });

  it('rejects missing commands and non-slash commands with the same name', async () => {
    const fixture = setup();
    fixture.guild.commands.fetch.mockResolvedValue(new Collection());
    expect(await fixture.check()).toBe(false);
    fixture.guild.commands.fetch.mockResolvedValue(new Collection([['menu', {...fixture.command, type: ApplicationCommandType.User}]]));
    expect(await fixture.check()).toBe(false);
  });

  it.each(['commands', 'permissions', 'member', 'channel', 'roles'] as const)('fails closed when fetching %s fails', async failed => {
    const fixture = setup();
    const requests = {
      commands: fixture.guild.commands.fetch,
      permissions: fixture.guild.commands.permissions.fetch,
      member: fixture.guild.members.fetch,
      channel: fixture.guild.channels.fetch,
      roles: fixture.guild.roles.fetch,
    };
    requests[failed].mockRejectedValue(new Error('Discord unavailable'));
    expect(await fixture.check()).toBe(false);
  });

  it('does not retain an allow after permissions are revoked', async () => {
    const fixture = setup();
    expect(await fixture.check()).toBe(true);
    fixture.permissions.set(fixture.command.id, [user(false)]);
    expect(await fixture.check()).toBe(false);
    expect(fixture.guild.commands.permissions.fetch).toHaveBeenCalledTimes(2);
  });
});
