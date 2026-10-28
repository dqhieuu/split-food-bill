import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseStore, databasePool } from '../../worker/src/supabase-store';
import type { Env } from '../../worker/src/env';
import { groupCommand, loadGroup, requireGroup } from '../../worker/src/groups';
import { mockProfiles } from '../../worker/src/discord';
import { groupMember, profileUser } from '../../worker/src/groups';
import {
	importSnapshot,
	verifySnapshot,
	checksum,
	validateSnapshot,
	type Snapshot
} from '../../scripts/lib/database-migration';

const url = process.env.LOCAL_DATABASE_TEST_URL;
if (
	!url ||
	!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
	!new URL(url).pathname.endsWith('_test')
)
	throw new Error(
		'Set LOCAL_DATABASE_TEST_URL to a disposable loopback PostgreSQL database ending in _test.'
	);
const env = { APP_ENV: 'local', SUPABASE_DATABASE_URL: url, DISCORD_ADMIN_IDS: mockProfiles[0].id } as Env;
const store = new SupabaseStore(env);
const other = new SupabaseStore(env);
const admin = profileUser(mockProfiles[0], null, env);
const member = { ...groupMember(mockProfiles[0], env), active: true, role: 'admin' as const };
const group = {
	id: 'test',
	name: 'Ăn trưa',
	discordGuildId: '300000000000000001',
	version: 0,
	createdBy: admin.id,
	createdAt: '2026-10-28T00:00:00Z'
};

beforeAll(async () => {
	await store.pool.query(await readFile('supabase/migrations/202610280001_documents.sql', 'utf8'));
});
beforeEach(async () => {
	await store.pool.query('truncate app_data.documents');
});
afterAll(async () => {
	await Promise.all([store.close(), other.close()]);
});

describe('Supabase Postgres store', () => {
	it('preserves full objects and keeps collection and group boundaries', async () => {
		const value = {
			id: 'receipt',
			amount: 70001,
			enabled: false,
			lines: [{ memberId: admin.id, amount: 33334 }],
			note: 'Cơm 🥢',
			optional: null
		};
		await store.commit([
			store.write('groups/a/bills/receipt', value),
			store.write('groups/b/bills/receipt', { id: 'other' }),
			store.write('groups/a/bills/receipt/notes/nested', { note: 'child' })
		]);
		expect(await store.get('groups/a/bills/receipt')).toEqual(value);
		expect(await store.list('groups/a/bills')).toEqual([value]);
		const many = await store.getMany(['groups/a/bills/receipt', 'groups/missing', 'groups/a/bills/receipt']);
		expect([...many]).toEqual([
			['groups/a/bills/receipt', value],
			['groups/missing', null]
		]);
		expect(await store.getMany([])).toEqual(new Map());
	});
	it('rolls back all writes on callback errors and create-only conflicts', async () => {
		await store.commit([store.write('groups/existing', { version: 1 })]);
		await expect(
			store.transaction(async (_tx, writes) => {
				writes.push(store.write('groups/new', { version: 0 }));
				throw new Error('cancel');
			})
		).rejects.toThrow('cancel');
		await expect(
			store.commit([
				store.write('groups/new', { version: 0 }),
				store.write('groups/existing', { version: 2 }, true)
			])
		).rejects.toMatchObject({ status: 409 });
		expect(await store.get('groups/new')).toBeNull();
		expect(await store.get('groups/existing')).toEqual({ version: 1 });
	});
	it('retries concurrent serializable updates without losing either write', async () => {
		await store.commit([store.write('groups/counter', { version: 0 })]);
		let reads = 0;
		let unlock!: () => void;
		const barrier = new Promise<void>((resolve) => {
			unlock = resolve;
		});
		const update = (database: SupabaseStore) =>
			database.transaction(async (tx, writes) => {
				const value = await database.get<{ version: number }>('groups/counter', tx);
				reads++;
				if (reads === 2) unlock();
				if (reads <= 2) await barrier;
				writes.push(database.write('groups/counter', { version: value!.version + 1 }));
			});
		await Promise.all([update(store), update(other)]);
		expect(await store.get('groups/counter')).toEqual({ version: 2 });
		expect(reads).toBeGreaterThan(2);
	});
	it('walks orphan ancestors and paginates document paths without skipping records', async () => {
		await store.commit(
			Array.from({ length: 55 }, (_, index) =>
				store.write(`groups/orphan/ledger/${String(index).padStart(3, '0')}`, { id: index })
			)
		);
		expect((await store.collectionIds('')).items).toEqual(['groups']);
		expect((await store.documentPaths('groups')).items).toEqual(['groups/orphan']);
		expect((await store.collectionIds('groups/orphan')).items).toEqual(['ledger']);
		const first = await store.documentPaths('groups/orphan/ledger');
		const second = await store.documentPaths('groups/orphan/ledger', first.nextPageToken);
		expect(first.items).toHaveLength(50);
		expect(second.items).toHaveLength(5);
		expect(new Set([...first.items, ...second.items]).size).toBe(55);
		expect(second.nextPageToken).toBeUndefined();
	});
	it('keeps domain commands atomic, idempotent and behind live membership permissions', async () => {
		const participant = { ...groupMember(mockProfiles[1], env), active: true };
		await store.commit([
			store.write('users/' + admin.id, admin),
			store.write('groups/test', group),
			store.write('groups/test/members/' + admin.id, member),
			store.write('groups/test/members/' + participant.id, participant)
		]);
		const input = {
			id: 'bill',
			description: 'Cơm',
			date: '2026-10-28T00:00:00Z',
			discordNotification: false,
			alreadyPaid: true,
			lines: [{ memberId: participant.id, amount: 33333, description: 'Cơm', note: '' }]
		};
		await Promise.all([
			groupCommand(store, 'test', admin.id, 'createBill', input),
			groupCommand(other, 'test', admin.id, 'createBill', input)
		]);
		const { state } = (await loadGroup(store, 'test', admin.id)) as any;
		expect(state.bills).toHaveLength(1);
		expect(state.ledger.map((entry: { type: string }) => entry.type).sort()).toEqual(['debt', 'payment']);
		await expect(requireGroup(store, 'another', admin.id)).rejects.toMatchObject({ status: 403 });
		await store.commit([store.write('groups/test/members/' + admin.id, { ...member, active: false })]);
		await expect(loadGroup(store, 'test', admin.id)).rejects.toMatchObject({ status: 403 });
	});
	it('does not give PUBLIC access to the private schema or table', async () => {
		const result = await store.pool.query(
			"select nspacl::text as grants from pg_namespace where nspname = 'app_data'"
		);
		expect(result.rows[0].grants).not.toContain('=U/');
		const table = await store.pool.query(
			"select relrowsecurity as rls from pg_class where oid = 'app_data.documents'::regclass"
		);
		expect(table.rows[0].rls).toBe(true);
	});
});

describe('lossless migration', () => {
	const records = [
		{ path: 'users/admin', data: { id: 'admin', preferences: { discordBillNotifications: false } } },
		{
			path: 'groups/a/ledger/e',
			data: { amount: 70001, from: 'a', to: 'b', type: 'debt', date: '2026-10-28', note: '' }
		}
	];
	const snapshot: Snapshot = {
		format: 'split-food-bill-firestore-v1',
		projectId: 'demo-lunchroom',
		readTime: '2026-10-28T00:00:00Z',
		checksum: checksum(records),
		records
	};
	it('imports every field, verifies checksums and supports identical retries', async () => {
		await importSnapshot(store.pool, snapshot);
		await importSnapshot(store.pool, snapshot);
		expect(await verifySnapshot(store.pool, snapshot)).toEqual({
			records: 2,
			checksum: snapshot.checksum,
			exactMatch: true
		});
	});
	it('refuses conflicting target data without applying a partial import', async () => {
		await store.commit([store.write('users/admin', { id: 'different' })]);
		await expect(importSnapshot(store.pool, snapshot)).rejects.toThrow('conflicting');
		expect(await store.get('groups/a/ledger/e')).toBeNull();
		expect(await store.get('users/admin')).toEqual({ id: 'different' });
	});
	it('detects tampered backups and unexpected target records', async () => {
		expect(() => validateSnapshot({ ...snapshot, records: [...records, records[0]] })).toThrow('duplicate');
		expect(() => validateSnapshot({ ...snapshot, checksum: 'wrong' })).toThrow('checksum');
		await importSnapshot(store.pool, snapshot);
		await store.commit([store.write('users/extra', { id: 'extra' })]);
		await expect(verifySnapshot(store.pool, snapshot)).rejects.toThrow('exactly match');
	});
	it('refuses insecure, placeholder, remote-local and loopback-production configurations', () => {
		expect(() =>
			databasePool({ APP_ENV: 'local', SUPABASE_DATABASE_URL: 'https://project.supabase.co' })
		).toThrow('protocol');
		expect(() =>
			databasePool({
				APP_ENV: 'local',
				SUPABASE_DATABASE_URL: 'postgres://postgres:[YOUR-PASSWORD]@localhost/test'
			})
		).toThrow('Replace');
		expect(() =>
			databasePool({ APP_ENV: 'local', SUPABASE_DATABASE_URL: 'postgres://user:pass@remote.example/test' })
		).toThrow('loopback');
		expect(() => databasePool({ APP_ENV: 'production', SUPABASE_DATABASE_URL: url })).toThrow('loopback');
	});
});
