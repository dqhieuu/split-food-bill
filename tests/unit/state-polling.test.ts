import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store } from '../../worker/src/store';
import { loadGroup } from '../../worker/src/groups';
import { DomainError } from '../../src/lib/domain/ledger';
import type { Env } from '../../worker/src/env';

const local = {
	APP_ENV: 'local',
	FIREBASE_PROJECT_ID: 'demo-lunchroom',
	FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
	FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
} as Env;
const uid = 'discord_100000000000000001';
const group = { id: 'group', name: 'Lunch', discordGuildId: '300000000000000001', version: 7 };
const member = { id: uid, active: true, role: 'member' };

afterEach(() => vi.restoreAllMocks());
describe('group state polling', () => {
	it('answers an unchanged poll from the group and member documents without reading collections', async () => {
		const store = new Store(local);
		const get = vi
			.spyOn(store, 'get')
			.mockImplementation(async (path: string) => (path.includes('/members/') ? member : group) as never);
		const list = vi.spyOn(store, 'list');
		const transaction = vi.spyOn(store, 'transaction');
		expect(await loadGroup(store, 'group', uid, 7)).toEqual({ unchanged: true, group, actor: uid });
		expect(get).toHaveBeenCalledTimes(2);
		expect(list).not.toHaveBeenCalled();
		expect(transaction).not.toHaveBeenCalled();
	});
	it('loads the full state when the known version is stale', async () => {
		const store = new Store(local);
		vi.spyOn(store, 'get').mockImplementation(
			async (path: string) => (path.includes('/members/') ? member : group) as never
		);
		const list = vi.spyOn(store, 'list').mockResolvedValue([]);
		vi.spyOn(store, 'transaction').mockImplementation(async (operation) => operation('tx', []));
		const result = await loadGroup(store, 'group', uid, 6);
		expect(result).toMatchObject({ group, actor: uid, state: { version: 7 } });
		expect(list).toHaveBeenCalled();
	});
	it('reports Firestore quota exhaustion as a retryable 429 instead of a generic outage', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
		const error = await new Store(local).call('/groups/group').catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(DomainError);
		expect(error).toMatchObject({ status: 429 });
	});
});
