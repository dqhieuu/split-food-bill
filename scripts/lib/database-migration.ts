import { createHash } from 'node:crypto';
import type pg from 'pg';
import { Store, decode } from '../../worker/src/store';

export type RecordData = { path: string; data: Record<string, unknown> };
export type Snapshot = {
	format: 'split-food-bill-firestore-v1';
	projectId: string;
	readTime: string;
	checksum: string;
	records: RecordData[];
};
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
export function checksum(records: RecordData[]) {
	return createHash('sha256')
		.update(canonical([...records].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))))
		.digest('hex');
}
export function validateSnapshot(value: unknown): Snapshot {
	const snapshot = value as Snapshot;
	if (
		snapshot?.format !== 'split-food-bill-firestore-v1' ||
		!snapshot.projectId ||
		!Number.isFinite(Date.parse(snapshot.readTime)) ||
		!Array.isArray(snapshot.records)
	)
		throw new Error('Invalid migration snapshot.');
	const paths = new Set<string>();
	for (const record of snapshot.records) {
		if (
			!record ||
			typeof record.path !== 'string' ||
			!/^[^/]+(?:\/[^/]+)*$/.test(record.path) ||
			record.path.split('/').length % 2 !== 0 ||
			!record.data ||
			typeof record.data !== 'object' ||
			Array.isArray(record.data) ||
			paths.has(record.path)
		)
			throw new Error('Snapshot has invalid or duplicate document paths.');
		paths.add(record.path);
	}
	if (checksum(snapshot.records) !== snapshot.checksum) throw new Error('Snapshot checksum does not match.');
	return snapshot;
}
/** Never silently convert a Firestore-only type or an integer outside JavaScript's exact range. */
function checkValue(value: Record<string, any>): void {
	if ('integerValue' in value && !Number.isSafeInteger(Number(value.integerValue)))
		throw new Error('Snapshot contains an integer outside the safe JSON range.');
	if ('doubleValue' in value && !Number.isFinite(value.doubleValue))
		throw new Error('Snapshot contains a non-finite number.');
	if ('mapValue' in value)
		for (const nested of Object.values(value.mapValue.fields ?? {}))
			checkValue(nested as Record<string, any>);
	else if ('arrayValue' in value) for (const nested of value.arrayValue.values ?? []) checkValue(nested);
	else if (
		!['stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'nullValue'].some((key) => key in value)
	)
		throw new Error('Snapshot contains an unsupported Firestore field type. Source is unchanged.');
}
/** All traversal and document reads use the same point in time, including orphan descendants. */
export async function exportFirestore(store: Store, projectId: string): Promise<Snapshot> {
	const readTime = new Date(Date.now() - 1000).toISOString();
	const records: RecordData[] = [];
	const escaped = (path: string) => path.split('/').map(encodeURIComponent).join('/');
	const visit = async (parent: string) => {
		let collectionPage = '';
		do {
			const response = await store.call(`${parent ? `/${escaped(parent)}` : ''}:listCollectionIds`, {
				method: 'POST',
				body: JSON.stringify({
					pageSize: 100,
					readTime,
					...(collectionPage ? { pageToken: collectionPage } : {})
				})
			});
			for (const collection of response.collectionIds ?? []) {
				const path = parent ? `${parent}/${collection}` : collection;
				let documentPage = '';
				do {
					const query = new URLSearchParams({
						pageSize: '300',
						showMissing: 'true',
						readTime,
						...(documentPage ? { pageToken: documentPage } : {})
					});
					const page = await store.call(`/${escaped(path)}?${query}`);
					for (const doc of page.documents ?? []) {
						const docPath = doc.name.slice(store.prefix.length + 1);
						if (doc.fields || doc.createTime) {
							const fields = doc.fields ?? {};
							for (const value of Object.values(fields)) checkValue(value as Record<string, any>);
							records.push({
								path: docPath,
								data: Object.fromEntries(
									Object.entries(fields).map(([key, value]) => [key, decode(value as any)])
								)
							});
						}
						await visit(docPath);
					}
					documentPage = page.nextPageToken ?? '';
				} while (documentPage);
			}
			collectionPage = response.nextPageToken ?? '';
		} while (collectionPage);
	};
	await visit('');
	return validateSnapshot({
		format: 'split-food-bill-firestore-v1',
		projectId,
		readTime,
		checksum: checksum(records),
		records
	});
}
/** Inserts a complete snapshot atomically. Existing identical rows allow retry; conflicts abort. */
export async function importSnapshot(pool: pg.Pool, snapshot: Snapshot) {
	validateSnapshot(snapshot);
	const client = await pool.connect();
	try {
		await client.query('begin');
		await client.query('lock table app_data.documents in exclusive mode');
		const existing = await client.query('select path, data from app_data.documents order by path');
		const source = new Map(snapshot.records.map((record) => [record.path, record.data]));
		for (const row of existing.rows)
			if (!source.has(row.path) || canonical(row.data) !== canonical(source.get(row.path)))
				throw new Error('Target contains conflicting data. Import will not overwrite or delete records.');
		for (let index = 0; index < snapshot.records.length; index += 200) {
			const batch = snapshot.records.slice(index, index + 200);
			await client.query(
				`insert into app_data.documents (path, data) select path, data from jsonb_to_recordset($1::jsonb) as record(path text, data jsonb) on conflict (path) do nothing`,
				[JSON.stringify(batch)]
			);
		}
		const target = await client.query('select path, data from app_data.documents order by path');
		if (checksum(target.rows) !== snapshot.checksum)
			throw new Error('Post-import checksum mismatch. Import rolled back.');
		await client.query('commit');
	} catch (error) {
		await client.query('rollback');
		throw error;
	} finally {
		client.release();
	}
}
export async function verifySnapshot(pool: pg.Pool, snapshot: Snapshot) {
	validateSnapshot(snapshot);
	const result = await pool.query('select path, data from app_data.documents order by path');
	const matches =
		result.rows.length === snapshot.records.length && checksum(result.rows) === snapshot.checksum;
	if (!matches) throw new Error('Target does not exactly match the snapshot. Do not cut over.');
	return { records: result.rows.length, checksum: snapshot.checksum, exactMatch: true };
}
export function snapshotSummary(snapshot: Snapshot) {
	const counts: Record<string, number> = {};
	for (const record of snapshot.records) {
		const collection = record.path
			.split('/')
			.slice(0, -1)
			.map((part, index) => (index % 2 ? '*' : part))
			.join('/');
		counts[collection] = (counts[collection] ?? 0) + 1;
	}
	return {
		projectId: snapshot.projectId,
		readTime: snapshot.readTime,
		records: snapshot.records.length,
		checksum: snapshot.checksum,
		collections: counts
	};
}
