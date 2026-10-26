import { describe, expect, it } from 'vitest';
import { personalPaymentHistory, spendingWindow } from '../../src/lib/domain/spending';
import { calendarMonth, spendingPercentageColor } from '../../src/lib/domain/calendar';
import type { Bill, LedgerEntry } from '../../src/lib/domain/types';

const bill = (id: string, date: string, total: number): Bill => ({
	id,
	date,
	total,
	organizer: 'an',
	description: id,
	emailReceipt: false,
	lines: [{ memberId: 'linh', amount: total, description: id, note: '' }]
});

describe('spending windows', () => {
	it('groups Vietnam-local days and fills missing days with zero', () => {
		const window = spendingWindow(
			[
				bill('before-midnight', '2026-10-25T16:59:00Z', 100),
				bill('after-midnight', '2026-10-25T17:00:00Z', 200)
			],
			'day',
			0,
			'2026-10-26'
		);
		expect(window.buckets).toHaveLength(7);
		expect(window.buckets.at(-2)?.value).toBe(100);
		expect(window.buckets.at(-1)?.value).toBe(200);
		expect(window.buckets[0].value).toBe(0);
	});
	it('starts weeks on Monday across month and year boundaries', () => {
		const window = spendingWindow(
			[
				bill('sunday', '2026-12-27T05:00:00Z', 100),
				bill('monday', '2026-12-28T05:00:00Z', 200),
				bill('sunday-again', '2027-01-03T05:00:00Z', 300),
				bill('next-monday', '2027-01-04T05:00:00Z', 400)
			],
			'week',
			0,
			'2027-01-03'
		);
		expect(window.buckets.at(-1)).toMatchObject({
			key: '2026-12-28',
			end: '2027-01-04',
			value: 500,
			current: true
		});
		expect(window.buckets.at(-2)?.value).toBe(100);
	});
	it('pages contiguous complete windows without gaps or overlap in all granularities', () => {
		for (const granularity of ['day', 'week', 'month'] as const) {
			const current = spendingWindow([], granularity, 0, '2028-03-01');
			const previous = spendingWindow([], granularity, 1, '2028-03-01');
			expect(previous.buckets.at(-1)?.end).toBe(current.start);
			expect(previous.buckets.some((bucket) => bucket.current)).toBe(false);
		}
		const months = spendingWindow([bill('leap-day', '2028-02-29T05:00:00Z', 100)], 'month', 0, '2028-03-01');
		expect(months.buckets.at(-2)).toMatchObject({ key: '2028-02-01', end: '2028-03-01', value: 100 });
	});
});

describe('personal payment history', () => {
	it('distinguishes covering a meal from sending a repayment and omits synthetic/self/inactive entries', () => {
		const entry = (
			id: string,
			from: string,
			to: string,
			type: LedgerEntry['type'],
			source: LedgerEntry['source'] = 'bill'
		): LedgerEntry => ({
			id,
			from,
			to,
			type,
			source,
			amount: 50000,
			date: '2026-10-26T05:00:00Z',
			description: id,
			note: '',
			creator: 'an',
			reference: id
		});
		const history = personalPaymentHistory(
			[
				entry('1', 'linh', 'an', 'debt'),
				entry('2', 'an', 'linh', 'debt'),
				entry('3', 'an', 'linh', 'payment', 'qr'),
				entry('4', 'linh', 'an', 'payment', 'manual'),
				entry('5', 'an', 'linh', 'payment', 'settlement'),
				entry('6', 'an', 'an', 'debt'),
				entry('7', 'former', 'an', 'debt'),
				entry('8', 'linh', 'huy', 'debt')
			],
			'an',
			new Set(['an', 'linh', 'huy'])
		);
		expect(history.map((item) => [item.entry.id, item.direction, item.counterpartyId])).toEqual([
			['4', 'received-transfer', 'linh'],
			['3', 'sent-transfer', 'linh'],
			['2', 'paid-for-you', 'linh'],
			['1', 'you-paid-for', 'linh']
		]);
	});
});

it('maps the displayed spending percentage from green through yellow to red', () => {
	expect(spendingPercentageColor(0)).toBe('#22C55E');
	expect(spendingPercentageColor(0.5)).toBe('#EAB308');
	expect(spendingPercentageColor(1)).toBe('#EF4444');
	expect(spendingPercentageColor(-1)).toBe('#22C55E');
	expect(spendingPercentageColor(2)).toBe('#EF4444');
	const month = calendarMonth(
		[bill('cheap', '2026-10-05T05:00:00Z', 60000), bill('costly', '2026-10-06T05:00:00Z', 120000)],
		'2026-10',
		() => 'An'
	);
	expect(month.days.get('2026-10-05')![0].color).toBe('#EAB308');
	expect(month.days.get('2026-10-06')![0].color).toBe('#EF4444');
});
