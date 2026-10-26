import type { Bill } from './types';
import { localDate, splitAmount } from './ledger';

export type CalendarBill = {
	id: string;
	description: string;
	payerId: string;
	payer: string;
	amount: number;
	/** amount / most expensive bill of the month, in [0, 1]. */
	ratio: number;
};

export type CalendarMonth = {
	/** Bills by local day (`YYYY-MM-DD`), most expensive first. */
	days: Map<string, CalendarBill[]>;
	totals: Map<string, number>;
	/** Sum of participant counts of the day's bills. */
	personMeals: Map<string, number>;
	maxDayTotal: number;
	maxBill: number;
	monthTotal: number;
	monthPersonMeals: number;
	/** Informational only; the bar colour uses spend per person-meal instead. */
	averageDailySpending: number | null;
	averagePersonMealSpending: number | null;
};

const GREEN_HUE = 142;

/** HSL hue for a ratio: 142 (green, cheap) → ~52 (yellow, medium) → 0 (red, most expensive). */
export function severityHue(ratio: number): number {
	return Math.round((1 - Math.min(1, Math.max(0, ratio))) * GREEN_HUE);
}

type Rgb = [number, number, number];
const INDICATOR_GREEN: Rgb = [0x22, 0xc5, 0x5e];
const INDICATOR_YELLOW: Rgb = [0xea, 0xb3, 0x08];
const INDICATOR_RED: Rgb = [0xef, 0x44, 0x44];
/** Bar colour when the month has no (or no positive) food spending to compare against. */
export const INDICATOR_NEUTRAL = '#9CA3AF';
const GREEN_UNTIL = 0.8;
const YELLOW_AT = 1;
const RED_FROM = 1.5;
const THRESHOLD_EPSILON = 1e-9;

/** Calendar days in a month (1–12) of the given year, leap years included. */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Informational average spend per calendar day; `null` without days or a finite total. */
export function averageDailySpending(total: number, days: number): number | null {
	return Number.isFinite(total) && days > 0 ? total / days : null;
}

/**
 * Unique participants of a bill. Participants are the bill's lines (one per member, enforced by
 * `createBill`); the payer counts only when they have a line. A bill without lines counts 0.
 */
export function participantCount(bill: Pick<Bill, 'lines'>): number {
	return new Set((bill.lines ?? []).map((line) => line.memberId)).size;
}

/** Spend per person-meal, or `null` when there are no person-meals or the inputs are not finite. */
export function averagePerPersonMeal(total: number, personMeals: number): number | null {
	if (!Number.isFinite(total) || !Number.isFinite(personMeals) || personMeals <= 0) return null;
	return total / personMeals;
}

/**
 * Day spend per person-meal relative to the month's spend per person-meal:
 * `(dailyTotal / dailyPersonMeals) / (monthlyTotal / monthlyPersonMeals)`.
 * `null` (neutral colour) when the month has no positive spending or no person-meals, or when the
 * day has spending but no person-meals. A day without spending is 0 (green); net-negative clamps to 0.
 */
export function spendingDensityRatio(
	dailyTotal: number,
	dailyPersonMeals: number,
	monthlyTotal: number,
	monthlyPersonMeals: number
): number | null {
	const reference = averagePerPersonMeal(monthlyTotal, monthlyPersonMeals);
	if (reference === null || !(reference > 0) || !Number.isFinite(dailyTotal)) return null;
	if (dailyTotal <= 0) return 0;
	const daily = averagePerPersonMeal(dailyTotal, dailyPersonMeals);
	if (daily === null) return null;
	const ratio = daily / reference;
	return Number.isFinite(ratio) ? Math.max(0, ratio) : null;
}

/**
 * Each participant's share of one bill. The stored line amounts are the authoritative shares (they
 * create the debts), so they are reused; only if they do not add up to the bill total is the total
 * split equally with the existing largest-remainder `splitAmount`, so no đồng is created or lost.
 */
export function individualAllocations(bill: Pick<Bill, 'lines' | 'total'>): Map<string, number> {
	const allocations = new Map<string, number>();
	const lines = (bill.lines ?? []).filter((line) => Number.isFinite(line.amount));
	const members = [...new Set(lines.map((line) => line.memberId))];
	if (!members.length || !Number.isSafeInteger(bill.total)) return allocations;
	if (lines.reduce((sum, line) => sum + line.amount, 0) === bill.total) {
		for (const line of lines)
			allocations.set(line.memberId, (allocations.get(line.memberId) ?? 0) + line.amount);
		return allocations;
	}
	splitAmount(
		bill.total,
		members.map(() => 1)
	).forEach((share, i) => allocations.set(members[i], share));
	return allocations;
}

/**
 * Sum of each member's shares over the bills of a period: a day (`YYYY-MM-DD`) or a month
 * (`YYYY-MM`) in Vietnam time. Bill totals are not changed or counted again.
 */
export function aggregateIndividualSpending(bills: Bill[], periodKey: string): Map<string, number> {
	const totals = new Map<string, number>();
	for (const bill of bills) {
		if (!Number.isFinite(bill.total) || !localDate(bill.date).startsWith(periodKey)) continue;
		for (const [memberId, amount] of individualAllocations(bill))
			totals.set(memberId, (totals.get(memberId) ?? 0) + amount);
	}
	return totals;
}

const toHex = ([r, g, b]: Rgb) =>
	'#' +
	[r, g, b]
		.map((channel) => channel.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase();
const mix = (from: Rgb, to: Rgb, t: number): Rgb =>
	from.map((channel, i) => Math.round(channel + (to[i] - channel) * Math.min(1, Math.max(0, t)))) as Rgb;
const snap = (ratio: number) =>
	[GREEN_UNTIL, YELLOW_AT, RED_FROM].find((stop) => Math.abs(ratio - stop) < THRESHOLD_EPSILON) ?? ratio;

/**
 * Solid indicator colour: green up to 0.8× the reference average, green → yellow until 1.0×,
 * yellow → red until 1.5×, red beyond. `null` or non-finite ratios get the neutral colour.
 */
export function spendingIndicatorColor(ratio: number | null): string {
	if (ratio === null || !Number.isFinite(ratio)) return INDICATOR_NEUTRAL;
	const value = snap(ratio);
	if (value <= GREEN_UNTIL) return toHex(INDICATOR_GREEN);
	if (value >= RED_FROM) return toHex(INDICATOR_RED);
	return value < YELLOW_AT
		? toHex(mix(INDICATOR_GREEN, INDICATOR_YELLOW, (value - GREEN_UNTIL) / (YELLOW_AT - GREEN_UNTIL)))
		: toHex(mix(INDICATOR_YELLOW, INDICATOR_RED, (value - YELLOW_AT) / (RED_FROM - YELLOW_AT)));
}

/** Groups one month (`YYYY-MM`) of bills, optionally limited to a single payer. */
export function calendarMonth(
	bills: Bill[],
	monthKey: string,
	payerName: (bill: Bill) => string,
	payerId?: string
): CalendarMonth {
	// Bill totals are validated positive integers; skip any corrupt non-finite total defensively.
	const inMonth = bills.filter(
		(bill) =>
			Number.isFinite(bill.total) &&
			localDate(bill.date).startsWith(monthKey) &&
			(!payerId || bill.organizer === payerId)
	);
	const maxBill = Math.max(1, ...inMonth.map((bill) => bill.total));
	const days = new Map<string, CalendarBill[]>();
	for (const bill of inMonth) {
		const key = localDate(bill.date);
		const entry: CalendarBill = {
			id: bill.id,
			description: bill.description,
			payerId: bill.organizer,
			payer: payerName(bill),
			amount: bill.total,
			ratio: bill.total / maxBill
		};
		days.set(key, [...(days.get(key) ?? []), entry]);
	}
	for (const [key, list] of days)
		days.set(
			key,
			[...list].sort((a, b) => b.amount - a.amount)
		);
	const totals = new Map([...days].map(([key, list]) => [key, list.reduce((s, b) => s + b.amount, 0)]));
	const personMeals = new Map<string, number>();
	for (const bill of inMonth) {
		const key = localDate(bill.date);
		personMeals.set(key, (personMeals.get(key) ?? 0) + participantCount(bill));
	}
	const monthTotal = [...totals.values()].reduce((a, b) => a + b, 0);
	const monthPersonMeals = [...personMeals.values()].reduce((a, b) => a + b, 0);
	const [year, month] = monthKey.split('-').map(Number);
	return {
		days,
		totals,
		personMeals,
		maxDayTotal: Math.max(1, ...totals.values()),
		maxBill,
		monthTotal,
		monthPersonMeals,
		averageDailySpending: averageDailySpending(monthTotal, daysInMonth(year, month)),
		averagePersonMealSpending: averagePerPersonMeal(monthTotal, monthPersonMeals)
	};
}
