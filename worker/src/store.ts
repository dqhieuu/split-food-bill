import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from './env';
import { isLocal } from './env';
import { DomainError } from '../../src/lib/domain/ledger';

type Value = {
	stringValue?: string;
	integerValue?: string;
	doubleValue?: number;
	booleanValue?: boolean;
	nullValue?: null;
	arrayValue?: { values?: Value[] };
	mapValue?: { fields?: Record<string, Value> };
};
type FirestoreWrite = {
	update?: { name: string; fields: Record<string, Value> };
	delete?: string;
	currentDocument?: { exists: boolean };
};
/** Database-neutral writes, applied atomically after the transaction callback finishes. */
export type Write = { path: string; value: object; createOnly?: boolean } | { path: string; delete: true };
export interface DataStore {
	get<T>(path: string, transaction?: string): Promise<T | null>;
	getMany<T>(paths: string[], transaction?: string): Promise<Map<string, T | null>>;
	list<T>(path: string, transaction?: string): Promise<T[]>;
	write(path: string, value: object, createOnly?: boolean): Write;
	delete(path: string): Write;
	commit(writes: Write[], transaction?: string): Promise<void>;
	transaction<T>(operation: (transaction: string, writes: Write[]) => Promise<T>): Promise<T>;
	collectionIds(parent: string, pageToken?: string): Promise<{ items: string[]; nextPageToken?: string }>;
	documentPaths(collection: string, pageToken?: string): Promise<{ items: string[]; nextPageToken?: string }>;
	close?(): Promise<void>;
}
const encode = (value: unknown): Value => {
	if (value === null) return { nullValue: null };
	if (typeof value === 'string') return { stringValue: value };
	if (typeof value === 'boolean') return { booleanValue: value };
	if (typeof value === 'number')
		return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
	if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
	return { mapValue: { fields: fields(value as Record<string, unknown>) } };
};
const fields = (value: Record<string, unknown>): Record<string, Value> =>
	Object.fromEntries(
		Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => [k, encode(v)])
	);
const decode = (value: Value): unknown => {
	if ('nullValue' in value) return null;
	if ('stringValue' in value) return value.stringValue;
	if ('integerValue' in value) return Number(value.integerValue);
	if ('doubleValue' in value) return value.doubleValue;
	if ('booleanValue' in value) return value.booleanValue;
	if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decode);
	return fromFields(value.mapValue?.fields ?? {});
};
const fromFields = (input: Record<string, Value>) =>
	Object.fromEntries(Object.entries(input).map(([k, v]) => [k, decode(v)]));
let googleAccess: { email: string; token: string; until: number } | undefined;
export async function privateKey(env: Env) {
	return importPKCS8(env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'RS256');
}
async function accessToken(env: Env) {
	if (isLocal(env)) return 'owner';
	if (googleAccess && googleAccess.email === env.FIREBASE_CLIENT_EMAIL && googleAccess.until > Date.now())
		return googleAccess.token;
	const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(env.FIREBASE_CLIENT_EMAIL!)
		.setSubject(env.FIREBASE_CLIENT_EMAIL!)
		.setAudience('https://oauth2.googleapis.com/token')
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(await privateKey(env));
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
	});
	const data = (await response.json()) as { access_token: string; expires_in: number };
	if (!response.ok) throw new Error('Firebase service-account authentication failed.');
	googleAccess = {
		email: env.FIREBASE_CLIENT_EMAIL!,
		token: data.access_token,
		until: Date.now() + Math.max(1, data.expires_in - 120) * 1000
	};
	return data.access_token;
}
export class Store implements DataStore {
	readonly prefix: string;
	readonly base: string;
	constructor(readonly env: Env) {
		this.prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
		this.base = `${isLocal(env) ? `http://${env.FIRESTORE_EMULATOR_HOST}` : 'https://firestore.googleapis.com'}/v1/${this.prefix}`;
	}
	async call(path: string, init: RequestInit = {}) {
		const response = await fetch(`${this.base}${path}`, {
			signal: AbortSignal.timeout(15000),
			...init,
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${await accessToken(this.env)}`,
				...init.headers
			}
		});
		if (response.status === 429)
			throw new DomainError('Cơ sở dữ liệu đang giới hạn yêu cầu. Vui lòng thử lại sau ít phút.', 429);
		if (!response.ok) {
			const error = new Error(`Firestore request failed (${response.status}).`) as Error & { status: number };
			error.status = response.status;
			throw error;
		}
		return response.json() as Promise<any>;
	}
	async get<T>(path: string, transaction?: string): Promise<T | null> {
		if (transaction) {
			return (await this.getMany<T>([path], transaction)).get(path) ?? null;
		}
		try {
			const doc = await this.call(
				`/${path}${transaction ? `?transaction=${encodeURIComponent(transaction)}` : ''}`
			);
			return fromFields(doc.fields ?? {}) as T;
		} catch (error) {
			if ((error as { status?: number }).status === 404) return null;
			throw error;
		}
	}
	async getMany<T>(paths: string[], transaction?: string): Promise<Map<string, T | null>> {
		const documents = [...new Set(paths)];
		const records = new Map<string, T | null>(documents.map((path) => [path, null]));
		if (!documents.length) return records;
		const results = await this.call(':batchGet', {
			method: 'POST',
			body: JSON.stringify({
				documents: documents.map((path) => `${this.prefix}/${path}`),
				...(transaction ? { transaction } : {})
			})
		});
		// Firestore returns documents in arbitrary order and includes explicit missing records.
		for (const result of Array.isArray(results) ? results : [results]) {
			if (result.found) {
				const path = result.found.name.slice(this.prefix.length + 1);
				if (records.has(path)) records.set(path, fromFields(result.found.fields ?? {}) as T);
			}
		}
		return records;
	}
	async list<T>(path: string, transaction?: string): Promise<T[]> {
		if (transaction) {
			const parts = path.split('/');
			const collectionId = parts.pop();
			const parent = parts.join('/');
			const results = await this.call(`${parent ? `/${parent}` : ''}:runQuery`, {
				method: 'POST',
				body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] }, transaction })
			});
			return (Array.isArray(results) ? results : [results])
				.filter((result) => result.document)
				.map((result) => fromFields(result.document.fields ?? {}) as T);
		}
		let pageToken = '';
		const rows: T[] = [];
		do {
			const query = new URLSearchParams({
				pageSize: '1000',
				...(transaction ? { transaction } : {}),
				...(pageToken ? { pageToken } : {})
			});
			const page = await this.call(`/${path}?${query}`);
			rows.push(
				...(page.documents ?? []).map((doc: { fields: Record<string, Value> }) => fromFields(doc.fields) as T)
			);
			pageToken = page.nextPageToken ?? '';
		} while (pageToken);
		return rows;
	}
	write(path: string, value: object, createOnly = false): Write {
		return { path, value, ...(createOnly ? { createOnly } : {}) };
	}
	delete(path: string): Write {
		return { path, delete: true };
	}
	async collectionIds(parent: string, pageToken = ''): Promise<{ items: string[]; nextPageToken?: string }> {
		const result = await this.call(`${parent ? `/${parent}` : ''}:listCollectionIds`, {
			method: 'POST',
			body: JSON.stringify({ pageSize: 50, ...(pageToken ? { pageToken } : {}) })
		});
		return { items: result.collectionIds ?? [], nextPageToken: result.nextPageToken };
	}
	async documentPaths(
		collection: string,
		pageToken = ''
	): Promise<{ items: string[]; nextPageToken?: string }> {
		const query = new URLSearchParams({
			pageSize: '50',
			showMissing: 'true',
			'mask.fieldPaths': 'id',
			...(pageToken ? { pageToken } : {})
		});
		const result = await this.call(`/${collection}?${query}`);
		return {
			items: (result.documents ?? []).map((document: { name: string }) =>
				document.name.slice(this.prefix.length + 1)
			),
			nextPageToken: result.nextPageToken
		};
	}
	async commit(writes: Write[], transaction?: string) {
		const encoded: FirestoreWrite[] = writes.map((write) =>
			'delete' in write
				? { delete: `${this.prefix}/${write.path}` }
				: {
						update: {
							name: `${this.prefix}/${write.path}`,
							fields: fields(write.value as Record<string, unknown>)
						},
						...(write.createOnly ? { currentDocument: { exists: false } } : {})
					}
		);
		if (writes.length || transaction)
			await this.call(':commit', {
				method: 'POST',
				body: JSON.stringify({ writes: encoded, ...(transaction ? { transaction } : {}) })
			});
	}
	async transaction<T>(operation: (transaction: string, writes: Write[]) => Promise<T>): Promise<T> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const { transaction } = await this.call(':beginTransaction', { method: 'POST', body: '{}' });
			try {
				const writes: Write[] = [];
				const result = await operation(transaction, writes);
				await this.commit(writes, transaction);
				return result;
			} catch (error) {
				await this.call(':rollback', { method: 'POST', body: JSON.stringify({ transaction }) }).catch(
					() => {}
				);
				if ((error as { status?: number }).status !== 409 || attempt === 4) throw error;
			}
		}
		throw new Error('Transaction retry limit reached.');
	}
}
export { encode, decode };
