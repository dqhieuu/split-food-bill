import { describe, it, expect, vi } from 'vitest';
import { Discord, canViewChannel, avatarUrl, mockProfiles } from '../../worker/src/discord';
import { encode, decode, Store } from '../../worker/src/store';
import { assertEnvironment, type Env } from '../../worker/src/env';
import { profileUser, groupMember, requireGroup } from '../../worker/src/groups';
import { authenticatedUser } from '../../worker/src/identity';

const local = {
	APP_ENV: 'local',
	FIREBASE_PROJECT_ID: 'demo-lunchroom',
	FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
	FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
	DISCORD_ADMIN_IDS: mockProfiles[0].id
} as Env;
describe('Discord channel permissions', () => {
	const guild = { id: 'guild', owner_id: 'owner' };
	const user = { user: { id: 'person', username: 'person' }, roles: ['a', 'b'] };
	const roles = [
		{ id: 'guild', permissions: '1024' },
		{ id: 'a', permissions: '0' },
		{ id: 'b', permissions: '0' }
	];
	const channel = { id: 'channel', guild_id: 'guild', name: 'lunch', type: 0 };
	it('combines everyone, role allow/deny and member-specific overrides in Discord order', () => {
		expect(canViewChannel(user, guild, roles, channel)).toBe(true);
		const denied = {
			...channel,
			permission_overwrites: [{ id: 'guild', type: 0, deny: '1024', allow: '0' }]
		};
		expect(canViewChannel(user, guild, roles, denied)).toBe(false);
		const allowed = {
			...denied,
			permission_overwrites: [
				...denied.permission_overwrites,
				{ id: 'a', type: 0, deny: '1024', allow: '0' },
				{ id: 'b', type: 0, deny: '0', allow: '1024' }
			]
		};
		expect(canViewChannel(user, guild, roles, allowed)).toBe(true);
		expect(
			canViewChannel(user, guild, roles, {
				...allowed,
				permission_overwrites: [
					...allowed.permission_overwrites,
					{ id: 'person', type: 1, allow: '0', deny: '1024' }
				]
			})
		).toBe(false);
	});
	it('honors server owner and administrator bypass without treating unrelated role permissions as membership', () => {
		expect(canViewChannel({ ...user, user: { id: 'owner', username: 'owner' } }, guild, [], channel)).toBe(
			true
		);
		expect(canViewChannel(user, guild, [{ id: 'a', permissions: '8' }], channel)).toBe(true);
		expect(canViewChannel(user, guild, [{ id: 'unrelated', permissions: '8' }], channel)).toBe(false);
	});
	it('does not expose channels hidden from the bot or thread/voice channels', async () => {
		const responses: Record<string, unknown> = {
			'/users/@me/guilds?limit=200&after=0': [{ id: '300000000000000001' }],
			'/users/@me': { id: '400000000000000001', username: 'bot' },
			'/guilds/300000000000000001': { id: '300000000000000001', owner_id: 'owner' },
			'/guilds/300000000000000001/roles': [{ id: '300000000000000001', permissions: '1024' }],
			'/guilds/300000000000000001/members/400000000000000001': {
				user: { id: '400000000000000001', username: 'bot' },
				roles: []
			},
			'/guilds/300000000000000001/channels': [
				{ id: 'visible', name: 'lunch', type: 0 },
				{
					id: 'hidden',
					name: 'private',
					type: 0,
					permission_overwrites: [{ id: '300000000000000001', type: 0, allow: '0', deny: '1024' }]
				},
				{ id: 'voice', name: 'voice', type: 2 },
				{ id: 'thread', name: 'thread', type: 11 }
			]
		};
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string) => {
				const path = input.replace('https://discord.com/api/v10', '');
				if (!(path in responses)) throw new Error(`Unexpected Discord endpoint: ${path}`);
				return Response.json(responses[path]);
			})
		);
		try {
			const channels = await new Discord({
				APP_ENV: 'production',
				DISCORD_BOT_TOKEN: 'test'
			} as Env).channels();
			expect(channels.map((entry) => entry.id)).toEqual(['visible']);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
describe('global and group identity boundaries', () => {
	it('uses Discord ids, imports members inactive and keeps global roles separate', () => {
		const global = profileUser(mockProfiles[0], null, local);
		expect(global.id).toBe(`discord_${mockProfiles[0].id}`);
		expect(global.role).toBe('admin');
		const member = groupMember(mockProfiles[0], local);
		expect(member.active).toBe(false);
		expect(member.role).toBe('member');
		expect(profileUser({ ...mockProfiles[1], email: undefined }, null, local).email).toBe('');
		expect(avatarUrl({ ...mockProfiles[0], avatar: 'a_test' })).toContain('a_test.gif');
	});
	it('does not let a global admin bypass inactive membership', async () => {
		const store = {
			get: vi
				.fn()
				.mockResolvedValueOnce({ id: 'group' })
				.mockResolvedValueOnce({ id: 'discord_100000000000000001', active: false, role: 'admin' })
		} as unknown as Store;
		await expect(requireGroup(store, 'group', 'discord_100000000000000001')).rejects.toMatchObject({
			status: 403
		});
	});
});
describe('Firestore transport and production isolation', () => {
	it('round-trips nested app fields without losing ids, arrays, null or optional fields', () => {
		const data = {
			id: 'discord_100000000000000001',
			amount: 55555,
			enabled: false,
			lines: [{ memberId: 'x', amount: 12.5 }],
			snapshot: { x: 'An' },
			missing: undefined,
			nil: null
		};
		expect(decode(encode(data))).toEqual({ ...data, missing: undefined });
	});
	it('rejects local emulator configuration on non-loopback hosts and any emulator flags in production', () => {
		expect(() => assertEnvironment(local, new Request('http://127.0.0.1:8787'))).not.toThrow();
		expect(() => assertEnvironment(local, new Request('https://worker.example'))).toThrow();
		expect(() =>
			assertEnvironment({ ...local, APP_ENV: 'production' }, new Request('https://worker.example'))
		).toThrow();
	});
	it('rejects unsigned emulator-shaped tokens in production before reading Firestore', async () => {
		const header = btoa(JSON.stringify({ alg: 'none' }));
		const payload = btoa(
			JSON.stringify({
				sub: 'discord_100000000000000001',
				exp: Date.now() / 1000 + 3600,
				aud: 'real-project',
				iss: 'https://securetoken.google.com/real-project',
				iat: Date.now() / 1000,
				auth_time: Date.now() / 1000
			})
		);
		const store = { get: vi.fn() } as unknown as Store;
		await expect(
			authenticatedUser(
				new Request('https://worker.example', { headers: { authorization: `Bearer ${header}.${payload}.` } }),
				{ ...local, APP_ENV: 'production', FIREBASE_PROJECT_ID: 'real-project' },
				store
			)
		).rejects.toMatchObject({ status: 401 });
		expect(store.get).not.toHaveBeenCalled();
	});
});
