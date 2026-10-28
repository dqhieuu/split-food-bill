import { describe, expect, it, vi } from 'vitest';
import { Store, encode } from '../../worker/src/store';
import type { Env } from '../../worker/src/env';
import { exportFirestore, snapshotSummary, validateSnapshot } from '../../scripts/lib/database-migration';

describe('Firestore migration snapshot', () => {
	it('uses one read time while traversing pages, orphan descendants and empty documents', async () => {
		const store = new Store({
			APP_ENV: 'local',
			FIREBASE_PROJECT_ID: 'demo-lunchroom',
			FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
		} as Env);
		const readTimes = new Set<string>();
		const value = {
			id: 'entry',
			amount: 70001,
			note: 'Cơm 🥢',
			preferences: { discordBillNotifications: false },
			lines: [{ amount: 33334 }],
			nil: null
		};
		const call = vi.spyOn(store, 'call').mockImplementation(async (path, init) => {
			if (path.endsWith(':listCollectionIds')) {
				const body = JSON.parse(String(init?.body));
				readTimes.add(body.readTime);
				if (path === ':listCollectionIds')
					return body.pageToken
						? { collectionIds: ['users'] }
						: { collectionIds: ['groups'], nextPageToken: 'page2' };
				if (path === '/groups/orphan:listCollectionIds') return { collectionIds: ['ledger'] };
				return {};
			}
			const request = new URL('https://example.test' + path);
			readTimes.add(request.searchParams.get('readTime')!);
			expect(request.searchParams.get('showMissing')).toBe('true');
			if (request.pathname === '/groups') return { documents: [{ name: `${store.prefix}/groups/orphan` }] };
			if (request.pathname === '/groups/orphan/ledger')
				return {
					documents: [
						{ name: `${store.prefix}/groups/orphan/ledger/entry`, fields: encode(value).mapValue!.fields }
					]
				};
			if (request.pathname === '/users')
				return { documents: [{ name: `${store.prefix}/users/empty`, createTime: '2026-10-28T00:00:00Z' }] };
			throw new Error('Unexpected source request');
		});
		const snapshot = await exportFirestore(store, 'demo-lunchroom');
		expect(readTimes).toEqual(new Set([snapshot.readTime]));
		expect(snapshot.records).toEqual([
			{ path: 'groups/orphan/ledger/entry', data: value },
			{ path: 'users/empty', data: {} }
		]);
		expect(snapshotSummary(snapshot).collections).toEqual({ 'groups/*/ledger': 1, users: 1 });
		expect(validateSnapshot(snapshot)).toBe(snapshot);
		expect(call.mock.calls.every(([, init]) => !init || init.method === 'POST')).toBe(true);
	});
	it.each([
		{ timestampValue: '2026-10-28T00:00:00Z' },
		{ integerValue: '9007199254740993' },
		{ doubleValue: 'NaN' }
	])('refuses lossy conversions for %j', async (field) => {
		const store = new Store({ APP_ENV: 'local', FIREBASE_PROJECT_ID: 'demo-lunchroom' } as Env);
		vi.spyOn(store, 'call').mockImplementation(async (path) =>
			path === ':listCollectionIds'
				? { collectionIds: ['users'] }
				: { documents: [{ name: `${store.prefix}/users/one`, fields: { value: field } }] }
		);
		await expect(exportFirestore(store, 'demo-lunchroom')).rejects.toThrow();
	});
	it('fails the export on quota exhaustion without treating it as an empty source', async () => {
		const store = new Store({ APP_ENV: 'local', FIREBASE_PROJECT_ID: 'demo-lunchroom' } as Env);
		vi.spyOn(store, 'call').mockRejectedValue(Object.assign(new Error('Quota exceeded'), { status: 429 }));
		await expect(exportFirestore(store, 'demo-lunchroom')).rejects.toMatchObject({ status: 429 });
	});
});
