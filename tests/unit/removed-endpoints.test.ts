import { describe, expect, it, vi } from 'vitest';
import worker from '../../worker/src/index';
import type { Env } from '../../worker/src/env';
import { createStore } from '../../worker/src/database';

const actor = 'discord_100000000000000001';
vi.mock('../../worker/src/identity', () => ({
	authenticatedUser: vi.fn(async () => ({ id: 'discord_100000000000000001', role: 'admin' })),
	sessionOperation: vi.fn(async () => null)
}));
vi.mock('../../worker/src/oauth', () => ({ oauth: vi.fn(async () => null) }));
vi.mock('../../worker/src/database', () => ({ createStore: vi.fn() }));

const env = {
	APP_ENV: 'local',
	FIREBASE_PROJECT_ID: 'demo-lunchroom',
	FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
	FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
} as Env;

describe('removed unused endpoints', () => {
	it.each([
		['/api/discord/dm', 404],
		['/api/groups/local/commands/retryBillNotification', 400],
		['/api/groups/local/commands/renameGroup', 400]
	] as const)('rejects POST %s without writing data', async (path, status) => {
		const member = { id: actor, active: true, role: 'admin' };
		const write = vi.fn();
		const store = {
			get: vi.fn(async (path: string) => (path.includes('/members/') ? member : { id: 'local', version: 1 })),
			list: vi.fn(async (path: string) => (path.endsWith('/members') ? [member] : [])),
			write,
			transaction: async (operation: (tx: string, writes: unknown[]) => Promise<unknown>) =>
				operation('tx', []),
			close: vi.fn(async () => {})
		};
		vi.mocked(createStore).mockReturnValue(store as unknown as ReturnType<typeof createStore>);
		const response = await worker.fetch(
			new Request(`http://127.0.0.1:8787${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			}),
			env
		);
		expect(response.status).toBe(status);
		expect(write).not.toHaveBeenCalled();
	});
});
