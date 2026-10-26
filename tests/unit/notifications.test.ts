import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverBillNotifications } from '../../worker/src/notifications';
import { billNotificationMessage } from '../../src/lib/domain/notifications';
import { Discord } from '../../worker/src/discord';
import type { Store } from '../../worker/src/store';
import type { Env } from '../../worker/src/env';
import type { Bill, Receipt } from '../../src/lib/domain/types';

const AN = 'discord_100000000000000001';
const LINH = 'discord_100000000000000002';
const env = { APP_ENV: 'local', FRONTEND_ORIGIN: 'http://127.0.0.1:5173' } as Env;
const bill: Bill = {
	id: 'bill-1',
	organizer: LINH,
	description: 'Bữa trưa',
	date: '2026-10-26T05:00:00.000Z',
	total: 100000,
	discordNotification: true,
	memberNames: { [AN]: 'Minh An', [LINH]: 'Thảo Linh' },
	lines: [
		{ memberId: LINH, amount: 45000, description: 'Cơm', note: '' },
		{ memberId: AN, amount: 55000, description: 'Phở', note: 'Ít cay' }
	]
};
function fixture() {
	const records = new Map<string, any>([
		['groups/local', { id: 'local', name: 'Hội ăn trưa' }],
		[`groups/local/members/${AN}`, { id: AN, active: true, role: 'admin' }],
		[`groups/local/members/${LINH}`, { id: LINH, active: true, role: 'member' }],
		['groups/local/bills/bill-1', structuredClone(bill)],
		[
			'groups/local/receipts/bill-1',
			{
				id: 'bill-1',
				billId: 'bill-1',
				status: 'queued',
				recipients: [LINH, AN],
				deliveries: bill.lines.map((line) => ({ memberId: line.memberId, status: 'queued', error: '' })),
				attempts: 0,
				error: '',
				createdAt: bill.date
			}
		]
	]);
	let tail = Promise.resolve();
	const store = {
		async get(path: string) {
			return structuredClone(records.get(path) ?? null);
		},
		write(path: string, value: unknown) {
			return { path, value: structuredClone(value) };
		},
		async transaction(operation: (tx: string, writes: any[]) => Promise<any>) {
			const previous = tail;
			let release!: () => void;
			tail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			try {
				const writes: any[] = [];
				const result = await operation('transaction', writes);
				for (const write of writes) records.set(write.path, write.value);
				return result;
			} finally {
				release();
			}
		}
	} as unknown as Store;
	return { store, records, receipt: () => records.get('groups/local/receipts/bill-1') as Receipt };
}
afterEach(() => vi.restoreAllMocks());
describe('bill Discord notifications', () => {
	it('uses frozen payer names, personalized shares and bounded Vietnamese message content', () => {
		const content = billNotificationMessage(bill, { name: 'Hội ăn trưa' }, AN, env.FRONTEND_ORIGIN);
		expect(content).toContain('**Hóa đơn: Bữa trưa**\nHội ăn trưa · Ăn vào');
		expect(content).toContain('Người đã thanh toán: **Thảo Linh**');
		expect(content).toContain('\n\n**Phần của bạn: 55.000 ₫**');
		expect(content).toContain('Tổng hóa đơn: **100.000 ₫**');
		expect(content).toContain('• Món ăn: Phở\n• Ghi chú: Ít cay');
		expect(content).toContain('[Mở Chia tiền ăn](<http://127.0.0.1:5173>)');
		expect(content).toContain('Thứ Hai');
		expect(content).toContain('Ít cay');
		const long = {
			...bill,
			description: '*'.repeat(300),
			lines: bill.lines.map((line) => ({ ...line, note: '*'.repeat(500), description: '*'.repeat(300) }))
		};
		const shortened = billNotificationMessage(long, { name: '*'.repeat(100) }, AN, env.FRONTEND_ORIGIN);
		expect(shortened.length).toBeLessThanOrEqual(2000);
		expect(shortened).toContain('Tổng hóa đơn: **100.000 ₫**');
		expect(shortened).toContain('\\*');
		expect(shortened).toContain('[Mở Chia tiền ăn]');
		expect(() => billNotificationMessage(bill, { name: 'Lunch' }, 'outsider', env.FRONTEND_ORIGIN)).toThrow();
	});
	it('persists partial failures and retries only failed recipients without changing the bill', async () => {
		const f = fixture();
		const dm = vi.spyOn(Discord.prototype, 'dm').mockImplementation(async (id) => {
			if (id === AN.slice(8)) throw new Error('Discord DM blocked');
			return { status: 'sent' };
		});
		await deliverBillNotifications(f.store, env, 'local', LINH, bill.id);
		expect(f.receipt().status).toBe('failed');
		expect(f.receipt().deliveries.map((delivery) => delivery.status)).toEqual(['sent', 'failed']);
		await deliverBillNotifications(f.store, env, 'local', LINH, bill.id);
		expect(dm).toHaveBeenCalledTimes(2);
		dm.mockResolvedValue({ status: 'sent' });
		await deliverBillNotifications(f.store, env, 'local', LINH, bill.id, true);
		expect(dm).toHaveBeenCalledTimes(3);
		expect(dm.mock.calls[2][0]).toBe(AN.slice(8));
		expect(f.receipt().status).toBe('sent');
		expect(f.receipt().attempts).toBe(2);
		expect(f.records.get('groups/local/bills/bill-1')).toEqual(bill);
		await deliverBillNotifications(f.store, env, 'local', LINH, bill.id, true);
		expect(dm).toHaveBeenCalledTimes(3);
	});
	it('claims concurrent delivery once and provides stable per-recipient nonces', async () => {
		const f = fixture();
		const dm = vi.spyOn(Discord.prototype, 'dm').mockResolvedValue({ status: 'simulated' });
		await Promise.all([
			deliverBillNotifications(f.store, env, 'local', LINH, bill.id),
			deliverBillNotifications(f.store, env, 'local', LINH, bill.id)
		]);
		expect(dm).toHaveBeenCalledTimes(2);
		expect(new Set(dm.mock.calls.map((call) => call[2])).size).toBe(2);
		expect(dm.mock.calls[0][2]).toMatch(/^[a-f0-9]{24}$/);
		expect(f.receipt().status).toBe('simulated');
		expect(f.receipt().attempts).toBe(1);
	});
	it('rejects unrelated members, inactive actors and nonparticipant recipients', async () => {
		const f = fixture();
		const dm = vi.spyOn(Discord.prototype, 'dm');
		const outsider = 'discord_100000000000000003';
		f.records.set(`groups/local/members/${outsider}`, { active: true, role: 'member' });
		await expect(
			deliverBillNotifications(f.store, env, 'local', outsider, bill.id, true)
		).rejects.toMatchObject({ status: 403 });
		f.records.get(`groups/local/members/${LINH}`).active = false;
		await expect(deliverBillNotifications(f.store, env, 'local', LINH, bill.id)).rejects.toMatchObject({
			status: 403
		});
		f.receipt().deliveries.push({ memberId: outsider, status: 'queued', error: '' });
		await expect(deliverBillNotifications(f.store, env, 'local', AN, bill.id, true)).rejects.toMatchObject({
			status: 400
		});
		expect(dm).not.toHaveBeenCalled();
	});
	it('honors opt-out and never calls Discord from the local transport', async () => {
		const f = fixture();
		f.records.get('groups/local/bills/bill-1').discordNotification = false;
		const api = vi.spyOn(Discord.prototype, 'api');
		await deliverBillNotifications(f.store, env, 'local', LINH, bill.id);
		expect(f.receipt().attempts).toBe(0);
		expect(await new Discord(env).dm(AN.slice(8), 'Test')).toEqual({ status: 'simulated' });
		expect(api).not.toHaveBeenCalled();
	});
});
