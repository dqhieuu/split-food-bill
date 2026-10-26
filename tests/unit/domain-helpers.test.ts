import { describe, expect, it } from 'vitest';
import {
	discountShares,
	equalShares,
	netBalance,
	pairBalance,
	roundUpTo,
	settlementPlan,
	shortCurrency
} from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { toLunar } from '../../src/lib/domain/lunar';
import { calendarMonth, severityHue } from '../../src/lib/domain/calendar';
import type { Bill, LedgerEntry } from '../../src/lib/domain/types';

describe('bill splitting', () => {
	it('rounds equal shares up so the payer never receives less', () => {
		expect(roundUpTo(3456, 2)).toBe(3500);
		expect(roundUpTo(3400, 2)).toBe(3400);
		expect(roundUpTo(3456, 0)).toBe(3456);
		expect(roundUpTo(3456.2, 0)).toBe(3457);
		const shares = equalShares(100000, 3, 2);
		expect(shares).toEqual([33400, 33400, 33400]);
		expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(100000);
		expect(equalShares(0, 2, 2)).toEqual([0, 0]);
	});

	it('scales listed prices to the discounted total with the last person absorbing rounding', () => {
		expect(discountShares([45000, 35000, 20000], 80000)).toEqual([36000, 28000, 16000]);
		const uneven = discountShares([33333, 33333, 33334], 70001);
		expect(uneven.reduce((a, b) => a + b, 0)).toBe(70001);
		expect(uneven.every(Number.isInteger)).toBe(true);
		expect(discountShares([10000, 20000], 0)).toEqual([10000, 20000]);
	});

	it('formats compact amounts without decimals', () => {
		expect(shortCurrency(1_550_000)).toBe('1.550k ₫');
		expect(shortCurrency(0)).toBe('0 ₫');
	});
});

describe('debt simplification (lunchsheet.gs minimizeTransactions)', () => {
	it('zeroes pairs, routes debtors through the lowest net position and preserves every net', () => {
		const state = createDemoState(new Date('2026-10-25T12:00:00.000Z'));
		const before = Object.fromEntries(state.members.map((m) => [m.id, netBalance(state.ledger, m.id)]));
		const plan = settlementPlan(state);
		expect(plan.hub).toBe(Object.entries(before).sort((a, b) => a[1] - b[1])[0][0]);
		const ledger: LedgerEntry[] = [
			...state.ledger,
			...plan.entries.map((entry, i) => ({
				...entry,
				id: `s-${i}`,
				date: '2026-10-26T00:00:00.000Z',
				creator: 'an',
				reference: 's'
			}))
		];
		for (const member of state.members) {
			expect(netBalance(ledger, member.id)).toBe(before[member.id]);
			for (const other of state.members)
				if (other.id !== member.id && member.id !== plan.hub && other.id !== plan.hub)
					expect(pairBalance(ledger, member.id, other.id)).toBe(0);
		}
		expect(plan.entries.some((e) => e.from === e.to)).toBe(false);
	});
});

describe('lunar calendar', () => {
	it('matches known Tết and mid-autumn dates', () => {
		expect(toLunar(17, 2, 2026)).toEqual({ day: 1, month: 1, year: 2026, leap: false });
		expect(toLunar(29, 1, 2025)).toEqual({ day: 1, month: 1, year: 2025, leap: false });
		expect(toLunar(25, 9, 2026)).toMatchObject({ day: 15, month: 8 });
		expect(toLunar(16, 2, 2026)).toMatchObject({ day: 29, month: 12, year: 2025 });
	});
	it('flags the 2025 leap sixth month', () => {
		expect(toLunar(25, 7, 2025)).toMatchObject({ day: 1, month: 6, leap: true });
	});
});

describe('spending calendar month', () => {
	const bill = (id: string, date: string, total: number, organizer = 'an'): Bill => ({
		id,
		organizer,
		description: `Bữa ${id}`,
		date,
		lines: [],
		total,
		discordNotification: false,
		memberNames: { an: 'Minh An', linh: 'Thảo Linh' }
	});
	const name = (b: Bill) => b.memberNames?.[b.organizer] ?? b.organizer;
	const bills = [
		bill('a', '2026-10-05T05:00:00.000Z', 100000),
		bill('b', '2026-10-05T06:00:00.000Z', 400000, 'linh'),
		bill('c', '2026-10-20T05:00:00.000Z', 200000),
		bill('d', '2026-09-30T05:00:00.000Z', 900000)
	];

	it('maps severity from green (cheap) through yellow to red (most expensive)', () => {
		expect(severityHue(0)).toBe(142);
		expect(severityHue(0.5)).toBe(71);
		expect(severityHue(1)).toBe(0);
		expect(severityHue(2)).toBe(0);
	});

	it('groups a month by local day, scaled to its largest bill and busiest day', () => {
		const month = calendarMonth(bills, '2026-10', name);
		expect(month.maxBill).toBe(400000);
		expect(month.maxDayTotal).toBe(500000);
		expect(month.monthTotal).toBe(700000);
		expect(month.days.get('2026-10-05')!.map((b) => [b.id, b.payer, b.ratio])).toEqual([
			['b', 'Thảo Linh', 1],
			['a', 'Minh An', 0.25]
		]);
		expect(month.days.has('2026-09-30')).toBe(false);
	});

	it('rescales when filtered to one payer', () => {
		const month = calendarMonth(bills, '2026-10', name, 'an');
		expect(month.maxBill).toBe(200000);
		expect(month.days.get('2026-10-05')!.map((b) => b.id)).toEqual(['a']);
		expect(month.monthTotal).toBe(300000);
	});
});
