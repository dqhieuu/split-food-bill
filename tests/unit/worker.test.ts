import { describe, it, expect, vi } from 'vitest';
import { Discord, avatarUrl, mockProfiles } from '../../worker/src/discord';
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
describe('Discord server discovery and membership', () => {
	it('restricts bot servers to the configured allowlist', async () => {
		const discord = new Discord({ APP_ENV: 'production', DISCORD_GUILD_IDS: '300000000000000002' } as Env);
		const api = vi.spyOn(discord, 'api').mockResolvedValue([
			{ id: '300000000000000001', name: 'Lunch' },
			{ id: '300000000000000002', name: 'Coffee' }
		]);
		expect(await discord.guilds()).toEqual([{ id: '300000000000000002', name: 'Coffee' }]);
		expect(api).toHaveBeenCalledWith('/users/@me/guilds?limit=200&after=0');
	});
	it('paginates server membership and excludes bots and incomplete memberships without channel filtering', async () => {
		const discord = new Discord({ APP_ENV: 'production' } as Env);
		vi.spyOn(discord, 'guilds').mockResolvedValue([{ id: '300000000000000001', name: 'Lunch' }]);
		const first = Array.from({ length: 1000 }, (_, i) => ({
			user: { id: String(100000000000000001n + BigInt(i)), username: 'member', bot: i === 0 },
			roles: [],
			pending: i === 1
		}));
		const api = vi
			.spyOn(discord, 'api')
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce([
				{ user: { id: '100000000000001001', username: 'last' }, roles: [], nick: 'Last member' }
			]);
		const members = await discord.members('300000000000000001');
		expect(members).toHaveLength(999);
		expect(members.at(-1)?.global_name).toBe('Last member');
		expect(api).toHaveBeenNthCalledWith(
			2,
			'/guilds/300000000000000001/members?limit=1000&after=100000000000001000'
		);
		await expect(discord.members('300000000000000002')).rejects.toMatchObject({ status: 404 });
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
