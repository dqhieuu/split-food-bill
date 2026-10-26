import { describe, expect, it } from 'vitest';
import {
	aggregateIndividualSpending,
	averagePerPersonMeal,
	calendarMonth,
	daysInMonth,
	individualAllocations,
	INDICATOR_NEUTRAL,
	participantCount,
	spendingDensityRatio,
	spendingIndicatorColor
} from '../../src/lib/domain/calendar';
import type { Bill } from '../../src/lib/domain/types';

const GREEN = '#22C55E';
const YELLOW = '#EAB308';
const RED = '#EF4444';
const HEX = /^#[0-9A-F]{6}$/;

/** Bill whose lines carry each participant's share; total = sum of shares, as `createBill` stores it. */
function bill(id: string, date: string, shares: [string, number][], organizer = 'an'): Bill {
	return {
		id,
		organizer,
		description: id,
		date,
		lines: shares.map(([memberId, amount]) => ({ memberId, amount, description: id, note: '' })),
		total: shares.reduce((sum, [, amount]) => sum + amount, 0),
		emailReceipt: false
	};
}
const name = (b: Bill) => b.organizer;
const OCT_5 = '2026-10-05T05:00:00.000Z';
const OCT_6 = '2026-10-06T05:00:00.000Z';
const OCT_7 = '2026-10-07T05:00:00.000Z';
const densityColor = (bills: Bill[], key: string) => {
	const month = calendarMonth(bills, key.slice(0, 7), name);
	const total = month.totals.get(key) ?? 0;
	return {
		width: total / month.maxDayTotal,
		color: spendingIndicatorColor(
			spendingDensityRatio(total, month.personMeals.get(key) ?? 0, month.monthTotal, month.monthPersonMeals)
		)
	};
};

describe('A. person-meal aggregation', () => {
	it('counts one person-meal per unique participant of a bill', () => {
		expect(participantCount(bill('one', OCT_5, [['an', 50000]]))).toBe(1);
		expect(
			participantCount(
				bill('three', OCT_5, [
					['an', 50000],
					['linh', 50000],
					['huy', 50000]
				])
			)
		).toBe(3);
	});

	it('counts the same person again for every bill they join', () => {
		const month = calendarMonth(
			[
				bill('breakfast', '2026-10-05T01:00:00.000Z', [['an', 30000]]),
				bill('lunch', '2026-10-05T05:00:00.000Z', [['an', 50000]]),
				bill('dinner', '2026-10-05T12:00:00.000Z', [['an', 80000]])
			],
			'2026-10',
			name
		);
		expect(month.personMeals.get('2026-10-05')).toBe(3);
		expect(month.monthPersonMeals).toBe(3);
	});

	it('does not inflate the count for duplicate participant records', () => {
		const duplicated = bill('dup', OCT_5, [
			['an', 40000],
			['an', 10000],
			['linh', 50000]
		]);
		expect(participantCount(duplicated)).toBe(2);
	});

	it('counts the payer once, and only when they have a line', () => {
		const payerEats = bill('payer-eats', OCT_5, [
			['an', 50000],
			['linh', 50000]
		]);
		const payerOnlyPays = bill('payer-pays', OCT_5, [['linh', 50000]], 'an');
		expect(participantCount(payerEats)).toBe(2);
		expect(participantCount(payerOnlyPays)).toBe(1);
	});

	it('handles a bill without participants without dividing by zero', () => {
		const empty = bill('empty', OCT_5, []);
		expect(participantCount(empty)).toBe(0);
		expect(participantCount({ lines: undefined as unknown as Bill['lines'] })).toBe(0);
		const month = calendarMonth([{ ...empty, total: 90000 }], '2026-10', name);
		expect(month.monthPersonMeals).toBe(0);
		expect(month.averagePersonMealSpending).toBeNull();
	});

	it('excludes bills outside the selected month (Vietnam time)', () => {
		const month = calendarMonth(
			[
				bill('sep', '2026-09-30T05:00:00.000Z', [['an', 100000]]),
				bill('oct', OCT_5, [
					['an', 100000],
					['linh', 100000]
				]),
				// 18:00 UTC on 31 Oct is 01:00 on 1 Nov in Vietnam.
				bill('nov', '2026-10-31T18:00:00.000Z', [['an', 100000]])
			],
			'2026-10',
			name
		);
		expect(month.monthPersonMeals).toBe(2);
		expect(month.monthTotal).toBe(200000);
		expect(month.personMeals.has('2026-10-31')).toBe(false);
	});
});

describe('B. spending density (month: 6.000.000 ₫ over 60 person-meals = 100.000 ₫)', () => {
	const ratio = (dailyTotal: number, dailyMeals: number) =>
		spendingDensityRatio(dailyTotal, dailyMeals, 6_000_000, 60);

	it('maps the reference examples to the expected ratio and colour', () => {
		expect(averagePerPersonMeal(6_000_000, 60)).toBe(100000);
		const cases: [number, number, number, string][] = [
			[0, 0, 0, GREEN],
			[160000, 2, 0.8, GREEN],
			[100000, 1, 1, YELLOW],
			[300000, 2, 1.5, RED],
			[400000, 2, 2, RED],
			[600000, 10, 0.6, GREEN]
		];
		for (const [total, meals, expected, color] of cases) {
			expect(ratio(total, meals)).toBeCloseTo(expected, 12);
			expect(spendingIndicatorColor(ratio(total, meals))).toBe(color);
		}
	});

	it('separates days with the same total but different person-meals', () => {
		expect(ratio(300000, 2)).toBe(1.5);
		expect(ratio(300000, 6)).toBe(0.5);
		expect(spendingIndicatorColor(ratio(300000, 2))).not.toBe(spendingIndicatorColor(ratio(300000, 6)));
	});

	it('recalculates when the monthly person-meal count changes', () => {
		expect(spendingDensityRatio(100000, 1, 6_000_000, 60)).toBe(1);
		expect(spendingDensityRatio(100000, 1, 6_000_000, 120)).toBe(2);
		expect(spendingDensityRatio(100000, 1, 6_000_000, 30)).toBe(0.5);
	});
});

describe('C. colour interpolation', () => {
	it('returns the exact stop colours', () => {
		expect(spendingIndicatorColor(0)).toBe(GREEN);
		expect(spendingIndicatorColor(0.8)).toBe(GREEN);
		expect(spendingIndicatorColor(1)).toBe(YELLOW);
		expect(spendingIndicatorColor(1.5)).toBe(RED);
	});

	it('interpolates RGB channels between the stops', () => {
		expect(spendingIndicatorColor(0.9)).toBe('#86BC33');
		expect(spendingIndicatorColor(1.25)).toBe('#ED7C26');
		for (const value of [0.81, 0.95, 1.01, 1.49]) expect(spendingIndicatorColor(value)).toMatch(HEX);
	});

	it('keeps stops stable under floating-point noise and never extrapolates past red', () => {
		expect(spendingIndicatorColor(0.8 + 1e-12)).toBe(GREEN);
		expect(spendingIndicatorColor(0.1 + 0.2 + 0.7)).toBe(YELLOW);
		expect(spendingIndicatorColor(1.5 - 1e-12)).toBe(RED);
		expect(spendingIndicatorColor(2)).toBe(RED);
		expect(spendingIndicatorColor(1e9)).toBe(RED);
	});

	it('is deterministic and always a valid CSS colour', () => {
		for (let value = 0; value <= 2; value += 0.01) {
			const color = spendingIndicatorColor(value);
			expect(color).toMatch(HEX);
			expect(spendingIndicatorColor(value)).toBe(color);
		}
	});
});

describe('D. individual allocation', () => {
	it('gives each participant their share of a bill', () => {
		const shares = individualAllocations(
			bill('dinner', OCT_5, [
				['an', 100000],
				['linh', 100000],
				['huy', 100000]
			])
		);
		expect(Object.fromEntries(shares)).toEqual({ an: 100000, linh: 100000, huy: 100000 });
	});

	it('sums a person’s shares across bills and leaves out non-participants', () => {
		const bills = [
			bill('lunch', OCT_5, [
				['an', 60000],
				['linh', 40000]
			]),
			bill('dinner', OCT_5, [
				['an', 90000],
				['huy', 30000]
			]),
			bill('next-day', OCT_6, [['linh', 50000]])
		];
		const day = aggregateIndividualSpending(bills, '2026-10-05');
		expect(Object.fromEntries(day)).toEqual({ an: 150000, linh: 40000, huy: 30000 });
		expect(day.has('mai')).toBe(false);
		expect(aggregateIndividualSpending(bills, '2026-10').get('linh')).toBe(90000);
	});

	it('skips bills without participants instead of dividing by zero', () => {
		expect(individualAllocations({ ...bill('empty', OCT_5, []), total: 90000 }).size).toBe(0);
	});

	it('splits equally with remainders when stored shares do not add up, without creating or losing money', () => {
		const inconsistent = {
			...bill('legacy', OCT_5, [
				['an', 1],
				['linh', 1],
				['huy', 1]
			]),
			total: 100000
		};
		const shares = individualAllocations(inconsistent);
		expect([...shares.values()].sort()).toEqual([33333, 33333, 33334]);
		expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(100000);
		const withInvalidLine = individualAllocations({
			...bill('bad-line', OCT_5, [
				['an', 50000],
				['linh', NaN]
			]),
			total: 50000
		});
		expect(Object.fromEntries(withInvalidLine)).toEqual({ an: 50000 });
	});

	it('allocations add up to each bill and leave bill totals untouched', () => {
		const bills = [
			bill('a', OCT_5, [
				['an', 33334],
				['linh', 33333],
				['huy', 33333]
			]),
			bill('b', OCT_6, [
				['an', 70000],
				['mai', 80000]
			])
		];
		const snapshot = structuredClone(bills);
		const before = calendarMonth(bills, '2026-10', name).monthTotal;
		for (const b of bills)
			expect([...individualAllocations(b).values()].reduce((x, y) => x + y, 0)).toBe(b.total);
		const month = aggregateIndividualSpending(bills, '2026-10');
		expect([...month.values()].reduce((a, b) => a + b, 0)).toBe(250000);
		expect(bills).toEqual(snapshot);
		expect(calendarMonth(bills, '2026-10', name).monthTotal).toBe(before);
	});
});

describe('E. edge cases', () => {
	it('uses the neutral colour for a month without spending or without person-meals', () => {
		expect(spendingIndicatorColor(spendingDensityRatio(0, 0, 0, 0))).toBe(INDICATOR_NEUTRAL);
		expect(spendingIndicatorColor(spendingDensityRatio(50000, 0, 500000, 0))).toBe(INDICATOR_NEUTRAL);
		expect(calendarMonth([], '2026-10', name).averagePersonMealSpending).toBeNull();
	});

	it('uses the neutral colour for a day with spending but no participants', () => {
		expect(spendingDensityRatio(90000, 0, 6_000_000, 60)).toBeNull();
		expect(spendingIndicatorColor(spendingDensityRatio(90000, 0, 6_000_000, 60))).toBe(INDICATOR_NEUTRAL);
	});

	it('keeps invalid amounts out of totals, ratios and colours', () => {
		const invalid: [number, number, number, number][] = [
			[NaN, 1, 6_000_000, 60],
			[100000, 1, Infinity, 60],
			[100000, NaN, 6_000_000, 60],
			[100000, 1, 6_000_000, NaN]
		];
		for (const args of invalid)
			expect(spendingIndicatorColor(spendingDensityRatio(...args))).toBe(INDICATOR_NEUTRAL);
		const month = calendarMonth(
			[bill('ok', OCT_5, [['an', 100000]]), { ...bill('broken', OCT_6, [['an', 1]]), total: NaN }],
			'2026-10',
			name
		);
		expect(month.monthTotal).toBe(100000);
		expect(month.monthPersonMeals).toBe(1);
		expect(spendingIndicatorColor(Number.NaN)).toBe(INDICATOR_NEUTRAL);
	});

	it('treats net-negative effective totals safely instead of as spending', () => {
		expect(spendingDensityRatio(-50000, 1, 6_000_000, 60)).toBe(0);
		expect(spendingDensityRatio(50000, 1, -6_000_000, 60)).toBeNull();
		expect(spendingDensityRatio(50000, 1, 0, 60)).toBeNull();
	});

	it('uses real month lengths for the informational daily average', () => {
		expect(daysInMonth(2024, 2)).toBe(29);
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2000, 2)).toBe(29);
		expect(daysInMonth(2100, 2)).toBe(28);
		const leap = calendarMonth([bill('feb', '2024-02-10T05:00:00.000Z', [['an', 290000]])], '2024-02', name);
		expect(leap.averageDailySpending).toBe(10000);
		const common = calendarMonth(
			[bill('feb', '2026-02-10T05:00:00.000Z', [['an', 280000]])],
			'2026-02',
			name
		);
		expect(common.averageDailySpending).toBe(10000);
	});

	it('updates colours when a bill amount changes', () => {
		const others = [bill('o1', OCT_6, [['an', 100000]]), bill('o2', OCT_7, [['linh', 100000]])];
		// Month 300.000 ₫ / 3 person-meals → the day sits exactly on the average.
		expect(densityColor([...others, bill('x', OCT_5, [['an', 100000]])], '2026-10-05').color).toBe(YELLOW);
		// Month 500.000 ₫ / 3 → 300.000 ₫ for one person is 1.8×.
		expect(densityColor([...others, bill('x', OCT_5, [['an', 300000]])], '2026-10-05').color).toBe(RED);
	});

	it('changes colour but not bar length when only the participants change', () => {
		const others = [bill('o1', OCT_6, [['an', 100000]]), bill('o2', OCT_7, [['linh', 100000]])];
		// Month 400.000 ₫ / 4 person-meals = 100.000 ₫; the day's 100.000 ₫ per person is 1.0×.
		const twoPeople = densityColor(
			[
				...others,
				bill('x', OCT_5, [
					['an', 100000],
					['linh', 100000]
				])
			],
			'2026-10-05'
		);
		// Month 400.000 ₫ / 6 ≈ 66.667 ₫; the day's 50.000 ₫ per person is 0.75×.
		const fourPeople = densityColor(
			[
				...others,
				bill('x', OCT_5, [
					['an', 50000],
					['linh', 50000],
					['huy', 50000],
					['mai', 50000]
				])
			],
			'2026-10-05'
		);
		expect(twoPeople.color).toBe(YELLOW);
		expect(fourPeople.color).toBe(GREEN);
		expect(fourPeople.width).toBe(twoPeople.width);
	});
});
