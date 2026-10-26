import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store, encode, decode } from '../../worker/src/store';
import { createGroup, groupMember, profileUser, syncMembers } from '../../worker/src/groups';
import { Discord, type DiscordProfile } from '../../worker/src/discord';
import type { Env } from '../../worker/src/env';

const env = {
	APP_ENV: 'local',
	FIREBASE_PROJECT_ID: 'demo-lunchroom',
	DISCORD_ADMIN_IDS: '100000000000000001'
} as Env;
const profiles: DiscordProfile[] = Array.from({ length: 200 }, (_, index) => ({
	id: String(100000000000000001n + BigInt(index)),
	username: `member${index}`
}));
const admin = profileUser(profiles[0], null, env);
const guildId = '300000000000000001';

function fixture() {
	const store = new Store(env);
	const records = new Map<string, any>([[`users/${admin.id}`, admin]]);
	const document = (path: string, value: any) => ({
		name: `${store.prefix}/${path}`,
		fields: Object.fromEntries(Object.entries(value).map(([key, value]) => [key, encode(value)]))
	});
	const call = vi.spyOn(store, 'call').mockImplementation(async (path, init) => {
		const body = JSON.parse(String(init?.body ?? '{}'));
		if (path === ':beginTransaction') return { transaction: 'tx' };
		if (path === ':rollback') return {};
		if (path === ':batchGet')
			return body.documents
				.slice()
				.reverse()
				.map((name: string) => {
					const path = name.slice(store.prefix.length + 1);
					return records.has(path) ? { found: document(path, records.get(path)) } : { missing: name };
				});
		if (path.endsWith(':runQuery')) {
			const parent = path.slice(1, -':runQuery'.length);
			const prefix = `${parent}/${body.structuredQuery.from[0].collectionId}/`;
			return [...records]
				.filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
				.map(([key, value]) => ({ document: document(key, value) }));
		}
		if (path === ':commit') {
			for (const write of body.writes) {
				const value = Object.fromEntries(
					Object.entries(write.update.fields).map(([key, value]) => [key, decode(value as any)])
				);
				records.set(write.update.name.slice(store.prefix.length + 1), value);
			}
			return {};
		}
		if (path.startsWith('/')) {
			const value = records.get(path.slice(1));
			if (!value) throw Object.assign(new Error('not found'), { status: 404 });
			return document(path.slice(1), value);
		}
		throw new Error(`Unexpected request: ${path}`);
	});
	vi.spyOn(Discord.prototype, 'guilds').mockResolvedValue([{ id: guildId, name: 'Lunch' }]);
	vi.spyOn(Discord.prototype, 'members').mockResolvedValue(profiles);
	return { store, records, call };
}
afterEach(() => vi.restoreAllMocks());

describe('batched Discord member imports', () => {
	it('maps unordered and missing batch results by document path and skips empty reads', async () => {
		const { store, call } = fixture();
		const values = await store.getMany([`users/${admin.id}`, 'users/missing', `users/${admin.id}`], 'tx');
		expect(values.get(`users/${admin.id}`)).toEqual(admin);
		expect(values.get('users/missing')).toBeNull();
		expect(JSON.parse(String(call.mock.calls[0][1]?.body))).toEqual({
			documents: [`${store.prefix}/users/${admin.id}`, `${store.prefix}/users/missing`],
			transaction: 'tx'
		});
		expect(await store.getMany([])).toEqual(new Map());
		expect(call).toHaveBeenCalledTimes(1);
	});

	it('creates a 200-person group with a bounded request count and preserves existing profiles', async () => {
		const { store, records, call } = fixture();
		const existing = { ...profileUser(profiles[1], null, env), email: 'saved@example.test', role: 'admin' };
		records.set(`users/${existing.id}`, existing);
		const group = await createGroup(store, admin, env, 'Lunch', guildId);
		expect(call.mock.calls.length).toBeLessThan(10);
		expect([...records.keys()].filter((path) => path.startsWith(`groups/${group.id}/members/`))).toHaveLength(
			200
		);
		expect(records.get(`users/${existing.id}`)).toEqual(existing);
		expect(records.get(`groups/${group.id}/members/${existing.id}`)).toMatchObject({
			active: false,
			role: 'member'
		});
		expect(records.get(`groups/${group.id}/members/${existing.id}`)).not.toHaveProperty('email');
		expect(records.get(`groups/${group.id}/members/${admin.id}`)).toMatchObject({
			active: true,
			role: 'admin'
		});
		expect(records.get(`discordGuilds/${guildId}`).groupId).toBe(group.id);
	});

	it('refreshes 200 members with bounded requests while preserving activation, roles and bank data', async () => {
		const { store, records, call } = fixture();
		records.set('groups/test', { id: 'test', discordGuildId: guildId, version: 1 });
		const member = { ...groupMember(profiles[0], env), active: true, role: 'admin', bankAccount: '123456' };
		records.set(`groups/test/members/${admin.id}`, member);
		await syncMembers(store, env, 'test', admin);
		expect(call.mock.calls.length).toBeLessThan(25);
		expect(records.get(`groups/test/members/${admin.id}`)).toEqual(member);
		expect(records.get(`groups/test/members/discord_${profiles[1].id}`)).toMatchObject({
			active: false,
			role: 'member'
		});
		expect(records.get('groups/test').version).toBe(2);
		expect(Discord.prototype.members).toHaveBeenCalledWith(guildId, true);
	});
});
