import type { Bill, LedgerEntry } from './types';
import { cancelledEntryIds, localDate } from './ledger';

export type SpendingGranularity = 'day' | 'week' | 'month';

const dateFromKey = (key: string) => new Date(`${key}T00:00:00Z`);
const keyFromDate = (date: Date) => date.toISOString().slice(0, 10);

function periodStart(key: string, granularity: SpendingGranularity): Date {
	const date = dateFromKey(key);
	if (granularity === 'month') date.setUTCDate(1);
	if (granularity === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	return date;
}

function shiftPeriod(date: Date, granularity: SpendingGranularity, steps: number): Date {
	const shifted = new Date(date);
	if (granularity === 'month') shifted.setUTCMonth(shifted.getUTCMonth() + steps);
	else shifted.setUTCDate(shifted.getUTCDate() + steps * (granularity === 'week' ? 7 : 1));
	return shifted;
}

/** Contiguous windows in Vietnam time. Weeks run Monday–Sunday; missing periods stay zero. */
export function spendingWindow(
	bills: Bill[],
	granularity: SpendingGranularity,
	windowOffset = 0,
	today = localDate(new Date())
) {
	const count = granularity === 'day' ? 7 : 6;
	const current = periodStart(today, granularity);
	const last = shiftPeriod(current, granularity, -Math.max(0, windowOffset) * count);
	const buckets = Array.from({ length: count }, (_, i) => {
		const start = shiftPeriod(last, granularity, i - count + 1);
		return {
			key: keyFromDate(start),
			end: keyFromDate(shiftPeriod(start, granularity, 1)),
			current: start.getTime() === current.getTime(),
			value: 0
		};
	});
	for (const bill of bills) {
		if (!Number.isFinite(bill.total)) continue;
		const key = localDate(bill.date);
		const bucket = buckets.find((period) => key >= period.key && key < period.end);
		if (bucket) bucket.value += bill.total;
	}
	const lastDay = dateFromKey(buckets.at(-1)!.end);
	lastDay.setUTCDate(lastDay.getUTCDate() - 1);
	return { buckets, start: buckets[0].key, end: keyFromDate(lastDay) };
}

/** Bill debts describe who paid on whose behalf; repayments describe actual transfer direction. */
export function personalPaymentHistory(ledger: LedgerEntry[], actor: string, activeIds: Set<string>) {
	const cancelled = cancelledEntryIds(ledger);
	return ledger
		.filter(
			(entry) =>
				entry.source !== 'settlement' &&
				!cancelled.has(entry.id) &&
				entry.from !== entry.to &&
				(entry.from === actor || entry.to === actor) &&
				activeIds.has(entry.from === actor ? entry.to : entry.from)
		)
		.map((entry) => ({
			entry,
			counterpartyId: entry.from === actor ? entry.to : entry.from,
			direction:
				entry.type === 'debt'
					? entry.to === actor
						? ('you-paid-for' as const)
						: ('paid-for-you' as const)
					: entry.from === actor
						? ('sent-transfer' as const)
						: ('received-transfer' as const)
		}))
		.sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.id.localeCompare(a.entry.id));
}
