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
	it('formats personal shares, other participants and a group-specific repayment link', () => {
		const message = billNotificationMessage(
			bill,
			{ id: 'local', name: 'Hội ăn trưa' },
			AN,
			env.FRONTEND_ORIGIN
		);
		expect(message.embeds).toHaveLength(1);
		const embed = message.embeds[0];
		expect(embed.title).toBe('Nhóm: Hội ăn trưa');
		expect(embed.description).toContain('**Hoá đơn:** Bữa trưa ngày Thứ Hai');
		expect(embed.description).toContain('**Bạn phải trả: 55.000 ₫** cho Phở');
		expect(embed.description).toContain('**Người khác:**\n- Thảo Linh trả 45.000 ₫ cho Cơm');
		expect(embed.description).not.toContain('Minh An trả');
		expect(embed.description).toContain('**Tổng cộng: 100.000 ₫**');
		expect(embed.description).toContain('/balances?group=local&to=' + LINH);
		expect(() =>
			billNotificationMessage(bill, { id: 'local', name: 'Lunch' }, 'outsider', env.FRONTEND_ORIGIN)
		).toThrow();
	});
	it('omits the other-participants section and repeated total for a one-person bill', () => {
		const single = { ...bill, lines: [bill.lines[1]], total: 55000 };
		const message = billNotificationMessage(single, { id: 'local', name: 'Lunch' }, AN, env.FRONTEND_ORIGIN);
		const description = message.embeds[0].description!;
		expect(description).not.toContain('Người khác');
		expect(description).not.toContain('Không có.');
		expect(description).not.toContain('Tổng cộng');
		expect(description).toContain('**Bạn phải trả: 55.000 ₫** cho Phở\n\n**Link trả tiền:**');
		expect(description).toContain('/balances?group=local&to=' + LINH);
	});
	it('places an attached image between the group heading and the bill details', () => {
		const message = billNotificationMessage(
			bill,
			{ id: 'local', name: 'Lunch' },
			AN,
			env.FRONTEND_ORIGIN,
			'hoa-don.webp'
		);
		expect(message.embeds).toHaveLength(2);
		expect(message.embeds[0]).toMatchObject({
			title: 'Nhóm: Lunch',
			image: { url: 'attachment://hoa-don.webp' }
		});
		expect(message.embeds[1].description).toContain('**Bạn phải trả:');
	});
	it('keeps large participant lists inside Discord limits without losing totals or payment links', () => {
		const long = {
			...bill,
			description: '*'.repeat(300),
			lines: Array.from({ length: 200 }, (_, i) => ({
				memberId: i === 0 ? AN : `discord_${100000000000001000n + BigInt(i)}`,
				amount: 45000,
				description: '*'.repeat(300),
				note: ''
			}))
		};
		const message = billNotificationMessage(
			long,
			{ id: 'local', name: '*'.repeat(100) },
			AN,
			env.FRONTEND_ORIGIN
		);
		const embed = message.embeds[0];
		expect(embed.title!.length).toBeLessThanOrEqual(256);
		expect(embed.description!.length).toBeLessThanOrEqual(4096);
		expect(embed.description).toContain('**Tổng cộng: 100.000 ₫**');
		expect(embed.description).toContain('**Link trả tiền:**');
		expect(embed.description).toContain('người khác ([xem hóa đơn]');
		expect(embed.description).toContain('\\*');
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
