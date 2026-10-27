import { describe, expect, it } from 'vitest';
import { saveUserPreferences } from '../../worker/src/preferences';
import { profileUser } from '../../worker/src/groups';
import { mockProfiles } from '../../worker/src/discord';
import type { Env } from '../../worker/src/env';
import type { Store } from '../../worker/src/store';
import type { GlobalUser } from '../../src/lib/domain/types';

const env = { APP_ENV: 'local' } as Env;
const first = profileUser(mockProfiles[0], null, env);
const second = profileUser(mockProfiles[1], null, env);

function fixture() {
	const users = new Map<string, GlobalUser>([
		[`users/${first.id}`, { ...first, lastActiveGroupId: 'lunch' }],
		[`users/${second.id}`, { ...second, preferences: { discordBillNotifications: true } }]
	]);
	const written: string[] = [];
	const store = {
		get: async (path: string) => structuredClone(users.get(path) ?? null),
		write: (path: string, user: typeof first) => ({ path, user }),
		transaction: async (
			operation: (tx: string, writes: { path: string; user: typeof first }[]) => Promise<unknown>
		) => {
			const writes: { path: string; user: typeof first }[] = [];
			const result = await operation('tx', writes);
			for (const write of writes) {
				users.set(write.path, write.user);
				written.push(write.path);
			}
			return result;
		}
	} as unknown as Store;
	return { users, store, written };
}

describe('account Discord notification preference', () => {
	it('persists off and on for the authenticated user without affecting another account or group selection', async () => {
		const { users, store, written } = fixture();
		await expect(saveUserPreferences(store, first.id, { discordBillNotifications: false })).resolves.toEqual({
			discordBillNotifications: false
		});
		expect(users.get(`users/${first.id}`)).toMatchObject({
			id: first.id,
			name: first.name,
			role: first.role,
			lastActiveGroupId: 'lunch',
			preferences: { discordBillNotifications: false }
		});
		expect(users.get(`users/${second.id}`)?.preferences?.discordBillNotifications).toBe(true);
		await saveUserPreferences(store, first.id, { discordBillNotifications: true });
		expect(users.get(`users/${first.id}`)?.preferences?.discordBillNotifications).toBe(true);
		expect(written).toEqual([`users/${first.id}`, `users/${first.id}`]);
	});

	it('preserves an explicit false preference when refreshing the Discord profile on login', async () => {
		const { users, store } = fixture();
		await saveUserPreferences(store, first.id, { discordBillNotifications: false });
		const user = profileUser(
			{ ...mockProfiles[0], global_name: 'Updated name' },
			users.get(`users/${first.id}`)!,
			env
		);
		expect(user.preferences?.discordBillNotifications).toBe(false);
		expect(user.lastActiveGroupId).toBe('lunch');
		expect(user.name).toBe('Updated name');
	});

	it('rejects invalid values and attempts to specify another user or modify their role', async () => {
		const { users, store, written } = fixture();
		const before = structuredClone(users);
		for (const input of [
			{ discordBillNotifications: 'false' },
			{},
			{ discordBillNotifications: false, uid: second.id },
			{ discordBillNotifications: false, role: 'admin' }
		]) {
			await expect(saveUserPreferences(store, first.id, input)).rejects.toThrow();
		}
		expect(users).toEqual(before);
		expect(written).toHaveLength(0);
	});

	it('does not recreate a user deleted before the preference transaction runs', async () => {
		const { users, store, written } = fixture();
		users.delete(`users/${first.id}`);
		await expect(
			saveUserPreferences(store, first.id, { discordBillNotifications: false })
		).rejects.toMatchObject({ status: 404 });
		expect(written).toHaveLength(0);
	});
});
