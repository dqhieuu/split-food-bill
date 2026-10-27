import { describe, expect, it, vi } from 'vitest';
import { renameGroup } from '../../worker/src/groups';
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
	const store = {
		get: vi.fn(async (path: string) =>
			path.includes('/members/') ? { id: actor, active: true, role } : group
		),
		write: (path: string, value: Record<string, unknown>) => ({ path, value }) as unknown as Write,
		transaction: async <T>(operation: (tx: string, writes: Write[]) => Promise<T>) => {
			const writes: Write[] = [];
			const result = await operation('tx', writes);
			committed.push(...(writes as unknown as Recorded[]));
			return result;
		}
	} as unknown as Store;
	return { store, committed };
}

describe('renaming a group', () => {
	it('lets a group admin rename the group, bumping the version and auditing it', async () => {
		const { store, committed } = fakeStore('admin');
		const renamed = await renameGroup(store, 'group', actor, 'Cà phê chiều');
		expect(renamed).toMatchObject({ name: 'Cà phê chiều', version: 5, discordGuildId: group.discordGuildId });
		expect(committed.find((write) => write.path === 'groups/group')?.value).toMatchObject({
			name: 'Cà phê chiều',
			version: 5
		});
		expect(committed.find((write) => write.path.startsWith('groups/group/audit/'))?.value).toMatchObject({
			action: 'renameGroup',
			actor
		});
	});
	it('refuses members who are not group admins', async () => {
		const { store, committed } = fakeStore('member');
		await expect(renameGroup(store, 'group', actor, 'Khác')).rejects.toMatchObject({ status: 403 });
		expect(committed).toHaveLength(0);
	});
});
