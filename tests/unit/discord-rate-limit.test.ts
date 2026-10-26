import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Discord, DiscordRateLimitError } from '../../worker/src/discord';
import { sessionOperation } from '../../worker/src/identity';
import type { Env } from '../../worker/src/env';
import worker from '../../worker/src/index';

vi.mock('../../worker/src/identity', () => ({
	sessionOperation: vi.fn(),
	authenticatedUser: vi.fn(async () => ({ id: 'discord_100000000000000001', role: 'admin' }))
}));

const env = { APP_ENV: 'production', DISCORD_BOT_TOKEN: 'test-bot-token', AUTH_SESSIONS: {} } as Env;
let now: number;
let waits: number[];
let records: Map<string, { value: unknown; expiresAt: number }>;
beforeEach(() => {
	now = 100000;
	waits = [];
	records = new Map();
	vi.spyOn(Date, 'now').mockImplementation(() => now);
	vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay = 0) => {
		waits.push(Number(delay));
		now += Number(delay);
		queueMicrotask(() => {
			if (typeof callback === 'function') callback();
		});
		return 0 as unknown as ReturnType<typeof setTimeout>;
	});
	vi.mocked(sessionOperation).mockImplementation(async (_env, op, key, extra = {}) => {
		if (op === 'get') {
			const record = records.get(key);
			return record && record.expiresAt > now ? record.value : null;
		}
		const data = extra as { ttl: number; value: unknown };
		records.set(key, { value: data.value, expiresAt: now + data.ttl });
		return true;
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Discord rate-limit handling', () => {
	it('returns the remaining cooldown in the HTTP response without exposing credentials', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValueOnce(Response.json({ retry_after: 15 }, { status: 429 }))
		);
		const response = await worker.fetch(new Request('https://worker.example/api/discord/guilds'), {
			...env,
			FIREBASE_PROJECT_ID: 'real-project',
			FIREBASE_API_KEY: 'public-key',
			FIREBASE_AUTH_DOMAIN: 'real-project.firebaseapp.com',
			FRONTEND_ORIGIN: 'https://app.example',
			FIREBASE_CLIENT_EMAIL: 'service@example.com',
			FIREBASE_PRIVATE_KEY: 'private-key',
			DISCORD_CLIENT_ID: 'client',
			DISCORD_CLIENT_SECRET: 'secret'
		});
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('15');
		const body = await response.text();
		expect(body).toContain('15 giây');
		expect(body).not.toContain(env.DISCORD_BOT_TOKEN);
	});
	it('honors Retry-After and retries a rejected request after a short wait', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({ retry_after: 0.1 }, { status: 429, headers: { 'retry-after': '0.2' } })
			)
			.mockResolvedValueOnce(Response.json({ ok: true }));
		vi.stubGlobal('fetch', fetch);
		expect(await new Discord(env).api('/test')).toEqual({ ok: true });
		expect(waits).toEqual([200]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[0][1].headers['user-agent']).toContain('DiscordBot');
	});
	it('shares global cooldowns across clients without repeatedly calling Discord', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ retry_after: 5, global: true }, { status: 429 }))
			.mockResolvedValueOnce(Response.json([]));
		vi.stubGlobal('fetch', fetch);
		await expect(new Discord(env).api('/one')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 5 });
		await expect(new Discord(env).api('/another')).rejects.toMatchObject({
			status: 429,
			retryAfterSeconds: 5
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		now += 5001;
		expect(await new Discord(env).api('/another')).toEqual([]);
	});
	it('waits for a known empty route bucket before making the next request', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json([], { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1' } })
			)
			.mockResolvedValueOnce(Response.json([]));
		vi.stubGlobal('fetch', fetch);
		await new Discord(env).api('/users/@me/guilds?after=0');
		await new Discord(env).api('/users/@me/guilds?after=200');
		expect(waits).toEqual([1000]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('bounds repeated short 429 retries and reports a useful wait time', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => Response.json({ retry_after: 0.1 }, { status: 429 }))
		);
		await expect(new Discord(env).api('/test')).rejects.toBeInstanceOf(DiscordRateLimitError);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(waits.reduce((sum, delay) => sum + delay, 0)).toBeLessThanOrEqual(2000);
	});
	it('does not retry an unknown cooldown or a failed network write', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
			.mockRejectedValueOnce(new Error('Connection lost'));
		vi.stubGlobal('fetch', fetch);
		await expect(new Discord(env).api('/test')).rejects.toMatchObject({ retryAfterSeconds: 30 });
		await expect(new Discord(env).api('/messages', { method: 'POST' })).rejects.toThrow('Connection lost');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(waits).toEqual([]);
	});
});

describe('Discord discovery caching', () => {
	it('refreshes a member list on demand while keeping normal reads cached', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json([{ id: 'guild', name: 'Lunch' }]))
			.mockResolvedValueOnce(Response.json([]))
			.mockResolvedValueOnce(Response.json([{ user: { id: 'member', username: 'New member' }, roles: [] }]));
		vi.stubGlobal('fetch', fetch);
		expect(await new Discord(env).members('guild')).toHaveLength(0);
		expect(await new Discord(env).members('guild')).toHaveLength(0);
		expect(await new Discord(env).members('guild', true)).toHaveLength(1);
		expect(fetch).toHaveBeenCalledTimes(3);
	});
	it('shares server and member results across preview and create requests', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(Response.json([{ id: 'guild', name: 'Lunch' }]))
			.mockResolvedValueOnce(Response.json([{ user: { id: 'member', username: 'Member' }, roles: [] }]));
		vi.stubGlobal('fetch', fetch);
		await new Discord(env).guilds();
		expect(await new Discord(env).members('guild')).toHaveLength(1);
		const creator = new Discord(env);
		await creator.guilds();
		await creator.members('guild');
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('refreshes expired discovery data and isolates the cache by bot identity', async () => {
		const fetch = vi.fn().mockImplementation(async () => Response.json([{ id: 'guild', name: 'Lunch' }]));
		vi.stubGlobal('fetch', fetch);
		await new Discord(env).guilds();
		await new Discord(env).guilds();
		expect(fetch).toHaveBeenCalledTimes(1);
		now += 60001;
		await new Discord(env).guilds();
		await new Discord({ ...env, DISCORD_BOT_TOKEN: 'different-token' }).guilds();
		expect(fetch).toHaveBeenCalledTimes(3);
		expect([...records.keys()].join(' ')).not.toContain('test-bot-token');
	});
});
