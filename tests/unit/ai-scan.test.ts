import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILL_SCAN_SCHEMA, chatCompletionsUrl, parseBillScan } from '../../src/lib/domain/ai';
import { readAiSettings, saveAiSettings, scanBill } from '../../worker/src/ai';
import type { Env } from '../../worker/src/env';
import type { Store, Write } from '../../worker/src/store';

const admin = 'discord_100000000000000001';
const member = 'discord_100000000000000002';
const imageId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp';
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
const webp = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]);
type Recorded = { path: string; value?: Record<string, unknown>; deleted?: boolean };

function fakeStore(documents: Record<string, Record<string, unknown>>) {
	const committed: Recorded[] = [];
	const store = {
		get: vi.fn(async (path: string) => documents[path] ?? null),
		write: (path: string, value: Record<string, unknown>) => ({ path, value }) as unknown as Write,
		delete: (path: string) => ({ path, deleted: true }) as unknown as Write,
		transaction: async <T>(operation: (tx: string, writes: Write[]) => Promise<T>) => {
			const writes: Write[] = [];
			const result = await operation('tx', writes);
			committed.push(...(writes as unknown as Recorded[]));
			return result;
		}
	} as unknown as Store;
	return { store, committed };
}
const groupDocs = (settings?: Record<string, unknown>) => ({
	'groups/group': { id: 'group', name: 'Ăn trưa', version: 7, ...(settings ? { aiEnabled: true } : {}) },
	[`groups/group/members/${admin}`]: { id: admin, active: true, role: 'admin' },
	[`groups/group/members/${member}`]: { id: member, active: true, role: 'member' },
	...(settings ? { 'groupAiSettings/group': settings } : {})
});
const configured = { endpoint: 'https://ai.example/v1', model: 'gpt-4o-mini', apiKey: 'sk-secret-123' };
const production = { APP_ENV: 'production' } as Env;
const bucket = () => ({
	head: vi.fn(async () => ({ customMetadata: { uploadedBy: member } })),
	get: vi.fn(async () => ({
		httpMetadata: { contentType: 'image/webp' },
		arrayBuffer: async () => webp.buffer
	}))
});
const sessions = (claimed: boolean) => ({
	idFromName: () => 'id',
	get: () => ({ fetch: async () => Response.json(claimed) })
});
const completion = (content: string) =>
	Response.json({ choices: [{ message: { role: 'assistant', content } }] });
afterEach(() => vi.unstubAllGlobals());

describe('bill scan contract', () => {
	it('requests exactly a bill name and an integer total', () => {
		expect(BILL_SCAN_SCHEMA).toMatchObject({
			type: 'object',
			required: ['billName', 'totalCost'],
			additionalProperties: false,
			properties: { billName: { type: 'string' }, totalCost: { type: 'integer' } }
		});
	});
	it.each([
		['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
		['https://api.openai.com/v1/', 'https://api.openai.com/v1/chat/completions'],
		['https://llm.example/v1/chat/completions', 'https://llm.example/v1/chat/completions']
	])('builds the chat completions URL from %s', (endpoint, url) => {
		expect(chatCompletionsUrl(endpoint)).toBe(url);
	});
	it('parses structured output, including fenced JSON from lenient providers', () => {
		expect(parseBillScan('{"billName":" Thịt chó ở Hoàn Béo ","totalCost":450000}')).toEqual({
			billName: 'Thịt chó ở Hoàn Béo',
			totalCost: 450000
		});
		expect(parseBillScan('```json\n{"billName":"Bún","totalCost":120000.4}\n```')).toEqual({
			billName: 'Bún',
			totalCost: 120000
		});
	});
	it.each([
		'not json',
		'{"billName":"Bún"}',
		'{"billName":"Bún","totalCost":-5}',
		'{"billName":"","totalCost":1}'
	])('rejects malformed output %s', (content) => {
		expect(() => parseBillScan(content)).toThrow();
	});
});

describe('AI settings', () => {
	it('lets a group admin save settings, enabling AI without exposing the key in the group or audit', async () => {
		const { store, committed } = fakeStore(groupDocs());
		const group = await saveAiSettings(store, production, 'group', admin, configured);
		expect(group).toMatchObject({ aiEnabled: true, version: 8 });
		expect(group).not.toHaveProperty('apiKey');
		expect(committed.find((write) => write.path === 'groupAiSettings/group')?.value).toMatchObject(
			configured
		);
		for (const write of committed.filter((entry) => entry.path !== 'groupAiSettings/group'))
			expect(JSON.stringify(write)).not.toContain('sk-secret-123');
	});
	it('keeps the saved key when the key field is left blank', async () => {
		const { store, committed } = fakeStore(groupDocs(configured));
		const group = await saveAiSettings(store, production, 'group', admin, {
			endpoint: 'https://other.example/v1',
			model: 'gpt-4.1-mini',
			apiKey: ''
		});
		expect(group.aiEnabled).toBe(true);
		expect(committed.find((write) => write.path === 'groupAiSettings/group')?.value).toMatchObject({
			endpoint: 'https://other.example/v1',
			apiKey: 'sk-secret-123'
		});
	});
	it('disables AI when a field is missing and deletes the settings when cleared', async () => {
		const partial = fakeStore(groupDocs(configured));
		const disabled = await saveAiSettings(partial.store, production, 'group', admin, {
			...configured,
			model: ''
		});
		expect(disabled.aiEnabled).toBe(false);
		const cleared = fakeStore(groupDocs(configured));
		const group = await saveAiSettings(cleared.store, production, 'group', admin, {
			endpoint: '',
			model: '',
			clearApiKey: true
		});
		expect(group.aiEnabled).toBe(false);
		expect(cleared.committed.find((write) => write.path === 'groupAiSettings/group')).toMatchObject({
			deleted: true
		});
	});
	it('refuses members and insecure endpoints', async () => {
		await expect(
			saveAiSettings(fakeStore(groupDocs()).store, production, 'group', member, configured)
		).rejects.toMatchObject({ status: 403 });
		await expect(
			saveAiSettings(fakeStore(groupDocs()).store, production, 'group', admin, {
				...configured,
				endpoint: 'http://ai.example/v1'
			})
		).rejects.toMatchObject({ status: 400 });
	});
	it('shows admins the endpoint and model but never the key', async () => {
		const { store } = fakeStore(groupDocs(configured));
		expect(await readAiSettings(store, 'group', admin)).toEqual({
			endpoint: configured.endpoint,
			model: configured.model,
			hasApiKey: true
		});
		await expect(readAiSettings(store, 'group', member)).rejects.toMatchObject({ status: 403 });
	});
});

describe('scanning a bill', () => {
	const env = (claimed = true) =>
		({ APP_ENV: 'production', BILL_IMAGES: bucket(), AUTH_SESSIONS: sessions(claimed) }) as unknown as Env;
	it('sends the photo with a strict JSON schema and returns the parsed result', async () => {
		const fetch = vi.fn(async () => completion('{"billName":"Bún ở Bún Chả Hương Liên","totalCost":250000}'));
		vi.stubGlobal('fetch', fetch);
		const { store } = fakeStore(groupDocs(configured));
		await expect(scanBill(store, env(), 'group', member, imageId)).resolves.toEqual({
			billName: 'Bún ở Bún Chả Hương Liên',
			totalCost: 250000
		});
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://ai.example/v1/chat/completions');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-secret-123');
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			model: 'gpt-4o-mini',
			response_format: { type: 'json_schema', json_schema: { strict: true, schema: BILL_SCAN_SCHEMA } }
		});
		expect(JSON.stringify(body.messages)).toContain('data:image/webp;base64,');
	});
	it('refuses when AI is not configured for the group', async () => {
		const { store } = fakeStore(groupDocs());
		await expect(scanBill(store, env(), 'group', member, imageId)).rejects.toMatchObject({ status: 400 });
	});
	it('limits how often one person can scan', async () => {
		vi.stubGlobal('fetch', vi.fn());
		const { store } = fakeStore(groupDocs(configured));
		await expect(scanBill(store, env(false), 'group', member, imageId)).rejects.toMatchObject({
			status: 429
		});
	});
	it('reports provider auth failures without leaking the key', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ error: { message: 'bad key sk-secret-123' } }, { status: 401 }))
		);
		const { store } = fakeStore(groupDocs(configured));
		const error = await scanBill(store, env(), 'group', member, imageId).catch((cause: unknown) => cause);
		expect(error).toMatchObject({ status: 502 });
		expect((error as Error).message).not.toContain('sk-secret');
	});
});
