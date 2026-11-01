import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureGroup } from '../../worker/src/groups';
import { Discord } from '../../worker/src/discord';
import type { Env } from '../../worker/src/env';
import type { Store, Write } from '../../worker/src/store';

const actor = 'discord_100000000000000001';
const group = {
	id: 'group',
	name: 'Ăn trưa',
	discordGuildId: '300000000000000001',
	createdBy: actor,
	createdAt: '2026-10-01T00:00:00.000Z',
	version: 4
};
type Recorded = { path: string; value: Record<string, unknown> };
function fakeStore(role: 'admin' | 'member') {
	const committed: Recorded[] = [];
	const indexes = new Map<string, { groupId: string }>([[group.discordGuildId, { groupId: group.id }]]);
	const store = {
		get: vi.fn(async (path: string) =>
			path.includes('/members/')
				? { id: actor, active: true, role }
				: path.startsWith('discordGuilds/')
					? (indexes.get(path.split('/')[1]) ?? null)
					: group
		),
		delete: (path: string) => ({ path, value: { deleted: true } }) as unknown as Write,
		write: (path: string, value: Record<string, unknown>) => ({ path, value }) as unknown as Write,
		transaction: async <T>(operation: (tx: string, writes: Write[]) => Promise<T>) => {
			const writes: Write[] = [];
			const result = await operation('tx', writes);
			committed.push(...(writes as unknown as Recorded[]));
			return result;
		}
	} as unknown as Store;
	return { store, committed, indexes };
}
afterEach(() => vi.restoreAllMocks());

describe('configuring the Discord server', () => {
	const target = '300000000000000002';
	const env = { APP_ENV: 'local' } as Env;
	it('updates the name and unique server index atomically while keeping the group identity', async () => {
		const { store, committed } = fakeStore('admin');
		vi.spyOn(Discord.prototype, 'guilds').mockResolvedValue([{ id: target, name: 'Coffee' }]);
		const updated = await configureGroup(store, env, group.id, actor, 'Coffee', target);
		expect(updated).toMatchObject({ id: group.id, name: 'Coffee', discordGuildId: target, version: 5 });
		expect(committed.find((write) => write.path === `discordGuilds/${group.discordGuildId}`)?.value).toEqual({
			deleted: true
		});
		expect(committed.find((write) => write.path === `discordGuilds/${target}`)?.value).toEqual({
			guildId: target,
			groupId: group.id
		});
		expect(
			committed.some((write) => write.path.includes('/members/') || write.path.includes('/bills/'))
		).toBe(false);
	});
	it('rejects non-admin members before discovering bot servers or committing changes', async () => {
		const { store, committed } = fakeStore('member');
		const discovery = vi.spyOn(Discord.prototype, 'guilds');
		await expect(configureGroup(store, env, group.id, actor, 'Coffee', target)).rejects.toMatchObject({
			status: 403
		});
		expect(discovery).not.toHaveBeenCalled();
		expect(committed).toHaveLength(0);
	});
	it('rejects servers that belong to another group without releasing the old association', async () => {
		const { store, committed, indexes } = fakeStore('admin');
		indexes.set(target, { groupId: 'other-group' });
		vi.spyOn(Discord.prototype, 'guilds').mockResolvedValue([{ id: target, name: 'Coffee' }]);
		await expect(configureGroup(store, env, group.id, actor, 'Coffee', target)).rejects.toMatchObject({
			status: 409
		});
		expect(committed).toHaveLength(0);
	});
	it('rejects unknown servers and avoids Discord calls for name-only changes', async () => {
		const { store, committed } = fakeStore('admin');
		const discovery = vi.spyOn(Discord.prototype, 'guilds').mockResolvedValue([]);
		await expect(configureGroup(store, env, group.id, actor, 'Coffee', target)).rejects.toMatchObject({
			status: 400
		});
		expect(committed).toHaveLength(0);
		discovery.mockClear();
		await configureGroup(store, env, group.id, actor, 'Renamed', group.discordGuildId);
		expect(discovery).not.toHaveBeenCalled();
	});
});
