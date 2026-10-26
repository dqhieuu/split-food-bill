import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	continueDatabaseReset,
	requireAvailableDatabase,
	RESET_CONFIRMATION,
	startDatabaseReset
} from '../../worker/src/database-reset';
import { sessionOperation } from '../../worker/src/identity';
import { Store } from '../../worker/src/store';
import type { Env } from '../../worker/src/env';
import type { GlobalUser } from '../../src/lib/domain/types';

vi.mock('../../worker/src/identity', () => ({ sessionOperation: vi.fn() }));
const ADMIN = 'discord_100000000000000001';
const OTHER = 'discord_100000000000000002';
const user = { id: ADMIN, role: 'admin' } as GlobalUser;
const env = { DISCORD_ADMIN_IDS: '100000000000000001' } as Env;
let jobs: Map<string, any>;
beforeEach(() => {
	jobs = new Map();
	vi.mocked(sessionOperation).mockImplementation(async (_env, op, key, data = {}) => {
		const input = data as { value?: unknown; challenge?: string };
		if (op === 'get') return structuredClone(jobs.get(key) ?? null);
		if (op === 'claim') {
			if (jobs.has(key)) return false;
			jobs.set(key, structuredClone(input.value ?? true));
			return true;
		}
		if (op === 'put') {
			jobs.set(key, structuredClone(input.value));
			return true;
		}
		const value = jobs.get(key);
		if (input.challenge && value?.challenge !== input.challenge) return null;
		jobs.delete(key);
		return structuredClone(value ?? null);
	});
});

function fixture() {
	const documents = new Map<string, unknown>([
		[`users/${ADMIN}`, user],
		[`users/${OTHER}`, { id: OTHER, role: 'member' }],
		['groups/g', { id: 'g' }],
		['groups/g/members/one', {}],
		['groups/g/bills/b', {}],
		['groups/g/ledger/e', {}],
		['groups/g/receipts/r', {}],
		['groups/g/settlements/s', {}],
		['groups/g/archives/a', {}],
		['groups/g/audit/event', {}],
		['groups/missing-parent/ledger/orphan', {}],
		['discordGuilds/g', {}],
		['custom/c/nested/record', {}]
	]);
	const page = (items: string[], token = '') => {
		const sorted = [...new Set(items)].sort().filter((item) => item > token);
		return { items: sorted.slice(0, 50), nextPageToken: sorted.length > 50 ? sorted[49] : undefined };
	};
	const store = {
		async get(path: string) {
			return structuredClone(documents.get(path) ?? null);
		},
		async collectionIds(parent: string, token?: string) {
			const prefix = parent ? `${parent}/` : '';
			return page(
				[...documents.keys()]
					.filter((path) => path.startsWith(prefix) && path.slice(prefix.length).includes('/'))
					.map((path) => path.slice(prefix.length).split('/')[0]),
				token
			);
		},
		async documentPaths(collection: string, token?: string) {
			return page(
				[...documents.keys()]
					.filter((path) => path.startsWith(collection + '/'))
					.map((path) => `${collection}/${path.slice(collection.length + 1).split('/')[0]}`),
				token
			);
		},
		delete(path: string) {
			return { delete: path };
		},
		commit: vi.fn(async (writes: { delete: string }[]) => {
			for (const write of writes) documents.delete(write.delete);
		})
	};
	return { documents, impl: store, store: store as unknown as Store };
}
async function finish(store: Store, id: string) {
	let result;
	for (let i = 0; i < 500; i++) {
		result = await continueDatabaseReset(store, env, ADMIN, id);
		if (result.status === 'complete') return result;
	}
	throw new Error('Reset did not finish');
}

describe('system administrator database reset', () => {
	it('requires the global admin role, exact confirmation and a configured recovery admin', async () => {
		const f = fixture();
		await expect(
			startDatabaseReset(f.store, env, { ...user, role: 'member' }, 'job', RESET_CONFIRMATION)
		).rejects.toMatchObject({ status: 403 });
		await expect(startDatabaseReset(f.store, env, user, 'job', 'yes')).rejects.toMatchObject({ status: 400 });
		await expect(
			startDatabaseReset(f.store, {} as Env, user, 'job', RESET_CONFIRMATION)
		).rejects.toMatchObject({ status: 400 });
		expect(f.impl.commit).not.toHaveBeenCalled();
		expect(jobs.size).toBe(0);
	});
	it('removes every collection including orphaned descendants and signs the owner out by deleting their profile last', async () => {
		const f = fixture();
		for (let i = 0; i < 121; i++) f.documents.set(`groups/g/ledger/entry-${String(i).padStart(3, '0')}`, {});
		await startDatabaseReset(f.store, env, user, 'job', RESET_CONFIRMATION);
		await expect(requireAvailableDatabase(env)).rejects.toMatchObject({ status: 503 });
		const first = await continueDatabaseReset(f.store, env, ADMIN, 'job');
		expect(first.status).toBe('running');
		expect(f.documents.has(`users/${ADMIN}`)).toBe(true);
		await finish(f.store, 'job');
		expect(f.documents.size).toBe(0);
		expect(f.impl.commit.mock.calls.at(-1)?.[0].at(-1)?.delete).toBe(`users/${ADMIN}`);
		await expect(requireAvailableDatabase(env)).resolves.toBeUndefined();
		const count = f.impl.commit.mock.calls.length;
		expect((await continueDatabaseReset(f.store, env, ADMIN, 'job')).status).toBe('complete');
		expect(f.impl.commit).toHaveBeenCalledTimes(count);
	});
	it('resumes after a failed batch without losing its checkpoint or releasing maintenance early', async () => {
		const f = fixture();
		await startDatabaseReset(f.store, env, user, 'job', RESET_CONFIRMATION);
		const checkpoint = structuredClone(jobs.get('database-reset:job:job'));
		f.impl.commit.mockRejectedValueOnce(new Error('Temporary Firestore failure'));
		await expect(continueDatabaseReset(f.store, env, ADMIN, 'job')).rejects.toThrow(
			'Temporary Firestore failure'
		);
		expect(jobs.get('database-reset:job:job')).toEqual(checkpoint);
		await expect(requireAvailableDatabase(env)).rejects.toMatchObject({ status: 503 });
		await finish(f.store, 'job');
		expect(f.documents.size).toBe(0);
	});
	it('prevents another user or another reset job from taking over an active wipe', async () => {
		const f = fixture();
		await startDatabaseReset(f.store, env, user, 'job', RESET_CONFIRMATION);
		await expect(continueDatabaseReset(f.store, env, OTHER, 'job')).rejects.toMatchObject({ status: 403 });
		await expect(startDatabaseReset(f.store, env, user, 'other', RESET_CONFIRMATION)).rejects.toMatchObject({
			status: 409
		});
		await expect(
			startDatabaseReset(f.store, env, { ...user, id: OTHER }, 'job', RESET_CONFIRMATION)
		).rejects.toMatchObject({ status: 403 });
		expect(f.impl.commit).not.toHaveBeenCalled();
	});
	it('does not run two batches concurrently', async () => {
		const f = fixture();
		await startDatabaseReset(f.store, env, user, 'job', RESET_CONFIRMATION);
		const results = await Promise.allSettled([
			continueDatabaseReset(f.store, env, ADMIN, 'job'),
			continueDatabaseReset(f.store, env, ADMIN, 'job')
		]);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		await finish(f.store, 'job');
		expect(f.documents.size).toBe(0);
	});
	it('lists missing parent documents when walking the real REST transport', async () => {
		const store = new Store({
			APP_ENV: 'local',
			FIREBASE_PROJECT_ID: 'demo-lunchroom',
			FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
		} as Env);
		const call = vi
			.spyOn(store, 'call')
			.mockResolvedValue({ documents: [{ name: `${store.prefix}/groups/orphan` }] });
		expect((await store.documentPaths('groups')).items).toEqual(['groups/orphan']);
		expect(call.mock.calls[0][0]).toContain('showMissing=true');
	});
});
