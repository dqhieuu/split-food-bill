import pg from 'pg';
import type { Env } from './env';
import { isLocal } from './env';
import type { DataStore, Write } from './store';
import { DomainError } from '../../src/lib/domain/ledger';
import { SUPABASE_ROOT_CA } from './supabase-ca';

/** One pool per request: Workers cannot share open TCP connections across requests. */
export function databasePool(
	env: Pick<Env, 'APP_ENV' | 'SUPABASE_DATABASE_URL' | 'SUPABASE_DB_CA' | 'SUPABASE_DB'>
) {
	const connectionString = env.SUPABASE_DB?.connectionString ?? env.SUPABASE_DATABASE_URL;
	if (!connectionString) throw new Error('Supabase database connection is not configured.');
	if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers' && !env.SUPABASE_DB)
		throw new Error('Configure the SUPABASE_DB Hyperdrive binding for Worker database connections.');
	const url = new URL(connectionString);
	if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol.');
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (decodeURIComponent(url.password).includes('[YOUR-PASSWORD]'))
		throw new Error('Replace [YOUR-PASSWORD] in SUPABASE_DATABASE_URL with the database password.');
	if (isLocal(env as Env) && (!loopback || env.SUPABASE_DB))
		throw new Error('Local database connections must use loopback.');
	if (!isLocal(env as Env) && loopback && !env.SUPABASE_DB)
		throw new Error('Production database must not use loopback.');
	// pg connection-string SSL options can override the explicit certificate verification below.
	for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
	return new pg.Pool({
		connectionString: url.toString(),
		// Hyperdrive verifies the upstream CA and hostname; its Worker binding is an internal socket.
		ssl:
			loopback || env.SUPABASE_DB
				? false
				: {
						rejectUnauthorized: true,
						ca: env.SUPABASE_DB_CA?.replace(/\\n/g, '\n') ?? SUPABASE_ROOT_CA
					},
		max: 2,
		connectionTimeoutMillis: 10000,
		idleTimeoutMillis: 10000,
		query_timeout: 15000,
		statement_timeout: 15000
	});
}

export class SupabaseStore implements DataStore {
	private readonly transactions = new Map<string, pg.PoolClient>();
	constructor(
		env: Env,
		readonly pool = databasePool(env)
	) {}
	private connection(transaction?: string): pg.Pool | pg.PoolClient {
		if (!transaction) return this.pool;
		const client = this.transactions.get(transaction);
		if (!client) throw new Error('Unknown or finished database transaction.');
		return client;
	}
	async get<T>(path: string, transaction?: string): Promise<T | null> {
		const result = await this.connection(transaction).query(
			'select data from app_data.documents where path = $1',
			[path]
		);
		return (result.rows[0]?.data as T) ?? null;
	}
	async getMany<T>(paths: string[], transaction?: string): Promise<Map<string, T | null>> {
		const records = new Map<string, T | null>(paths.map((path) => [path, null]));
		if (!records.size) return records;
		const result = await this.connection(transaction).query(
			'select path, data from app_data.documents where path = any($1::text[])',
			[[...records.keys()]]
		);
		for (const row of result.rows) records.set(row.path, row.data as T);
		return records;
	}
	async list<T>(path: string, transaction?: string): Promise<T[]> {
		const result = await this.connection(transaction).query(
			'select data from app_data.documents where collection = $1 order by path',
			[path]
		);
		return result.rows.map((row) => row.data as T);
	}
	write(path: string, value: object, createOnly = false): Write {
		return { path, value, ...(createOnly ? { createOnly } : {}) };
	}
	delete(path: string): Write {
		return { path, delete: true };
	}
	async commit(writes: Write[], transaction?: string): Promise<void> {
		if (!transaction) {
			if (writes.length)
				await this.transaction(async (_tx, pending) => {
					pending.push(...writes);
				});
			return;
		}
		const client = this.connection(transaction);
		// Preserve write order and create-only semantics; one failed write rolls the entire batch back.
		for (const write of writes) {
			if ('delete' in write)
				await client.query('delete from app_data.documents where path = $1', [write.path]);
			else
				await client.query(
					`insert into app_data.documents (path, data) values ($1, $2::jsonb) ${write.createOnly ? '' : 'on conflict (path) do update set data = excluded.data'}`,
					[write.path, JSON.stringify(write.value)]
				);
		}
	}
	async transaction<T>(operation: (transaction: string, writes: Write[]) => Promise<T>): Promise<T> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const client = await this.pool.connect();
			const id = crypto.randomUUID();
			let broken = false;
			try {
				await client.query('begin isolation level serializable');
				this.transactions.set(id, client);
				const writes: Write[] = [];
				const result = await operation(id, writes);
				await this.commit(writes, id);
				await client.query('commit');
				return result;
			} catch (error) {
				await client.query('rollback').catch(() => {
					broken = true;
				});
				const code = (error as { code?: string }).code;
				if (code === '23505') throw new DomainError('Bản ghi đã tồn tại. Vui lòng tải lại và thử lại.', 409);
				if (!['40001', '40P01'].includes(code ?? '') || attempt === 4) throw error;
			} finally {
				this.transactions.delete(id);
				client.release(broken);
			}
		}
		throw new Error('Transaction retry limit reached.');
	}
	private async paths(prefix: string, pageToken: string, collections: boolean) {
		// Include ancestors that only have subcollections, matching Firestore showMissing semantics.
		const result = await this.pool.query(
			`select distinct ${collections ? '' : '$1 || '}split_part(substring(path from length($1) + 1), '/', 1) as item
			 from app_data.documents
			 where starts_with(path, $1) ${collections ? "and position('/' in substring(path from length($1) + 1)) > 0" : ''}
			 and ${collections ? '' : '$1 || '}split_part(substring(path from length($1) + 1), '/', 1) > $2
			 order by item limit 51`,
			[prefix, pageToken]
		);
		const items: string[] = result.rows.slice(0, 50).map((row) => row.item);
		return { items, ...(result.rows.length > 50 ? { nextPageToken: items.at(-1) } : {}) };
	}
	collectionIds(parent: string, pageToken = '') {
		return this.paths(parent ? `${parent}/` : '', pageToken, true);
	}
	documentPaths(collection: string, pageToken = '') {
		return this.paths(`${collection}/`, pageToken, false);
	}
	close() {
		return this.pool.end();
	}
}
