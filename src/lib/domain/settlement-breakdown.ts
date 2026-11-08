import { cancelledEntryIds, compareLedgerEntries } from './ledger';
import type { AppState, LedgerEntry, Settlement } from './types';

export type CashFlowPart = {
	entry: LedgerEntry;
	amount: number;
	billId?: string;
};

export type CashFlowRoute = {
	from: string;
	to: string;
	amount: number;
	parts: CashFlowPart[];
};

type BatchFlow = { batch: Settlement; before: CashFlowRoute[]; after: CashFlowRoute[] };
type Pair = {
	from: string;
	parts: Map<string, CashFlowPart>;
	qrCutoff?: { order: number; parts: Map<string, CashFlowPart> };
};
type Event = { date: string; entries: LedgerEntry[]; batch?: Settlement; order: number };
type TransferBillMatches = { billIds: string[]; uncertain: boolean };

const total = (parts: Iterable<CashFlowPart>) => [...parts].reduce((sum, part) => sum + part.amount, 0);

function addPart(parts: Map<string, CashFlowPart>, part: CashFlowPart, sign: number) {
	const amount = (parts.get(part.entry.id)?.amount ?? 0) + part.amount * sign;
	if (amount) parts.set(part.entry.id, { ...part, amount });
	else parts.delete(part.entry.id);
}

function totalsByBill(parts: CashFlowPart[]) {
	const billTotals = new Map<string, number>();
	for (const { billId, amount } of parts) {
		if (billId) billTotals.set(billId, (billTotals.get(billId) ?? 0) + amount);
	}
	return billTotals;
}

function outstandingParts(parts: CashFlowPart[]) {
	const billTotals = totalsByBill(parts);
	return parts.filter(({ billId }) => !billId || billTotals.get(billId) !== 0);
}

/** Replays the booked transfers so a payment remains separate from the routes it helped fund. */
export function settlementBreakdown(state: AppState, accountId: string) {
	const batches = new Map(state.settlements.map((batch) => [batch.id, batch]));
	const ledger = new Map(state.ledger.map((entry) => [entry.id, entry]));
	const events = new Map<string, Event>();
	for (const entry of state.ledger) {
		const batch = batches.get(entry.reference);
		const settled = batch && entry.source === 'settlement';
		const reversed =
			batch &&
			entry.source === 'reversal' &&
			ledger.get(entry.id.replace(/-undo$/, ''))?.source === 'settlement';
		const key = settled ? `batch:${batch.id}` : reversed ? `undo:${batch.id}` : `entry:${entry.id}`;
		const event = events.get(key) ?? {
			date: entry.createdAt ?? entry.date,
			entries: [],
			batch: settled ? batch : undefined,
			order: reversed ? 3 : settled ? 2 : entry.type === 'debt' ? 0 : 1
		};
		event.entries.push(entry);
		events.set(key, event);
	}
	const ordered = [...events.values()].sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			a.order - b.order ||
			(a.batch?.version ?? 0) - (b.batch?.version ?? 0) ||
			a.entries[0].id.localeCompare(b.entries[0].id)
	);
	const pairs = new Map<string, Pair>();
	const booked = new Map<string, { order: number; parts: CashFlowPart[] }>();
	const transferBills = new Map<string, TransferBillMatches>();
	const history: BatchFlow[] = [];
	const pairKey = (from: string, to: string) => JSON.stringify(from < to ? [from, to] : [to, from]);
	function pairParts(from: string, to: string) {
		const pair = pairs.get(pairKey(from, to));
		if (!pair) return [];
		const parts = pair.qrCutoff ? new Map(pair.parts) : pair.parts;
		if (pair.qrCutoff) for (const part of pair.qrCutoff.parts.values()) addPart(parts, part, -1);
		return [...parts.values()].map((part) => ({
			...part,
			amount: from === pair.from ? part.amount : -part.amount
		}));
	}
	function record(entry: LedgerEntry, parts: CashFlowPart[]) {
		booked.set(entry.id, { order: booked.size, parts });
		if (entry.from === entry.to) return;
		const key = pairKey(entry.from, entry.to);
		const pair: Pair = pairs.get(key) ?? { from: entry.from, parts: new Map() };
		for (const part of parts) addPart(pair.parts, part, pair.from === entry.from ? 1 : -1);
		pairs.set(key, pair);
		return pair;
	}
	const involvesAccount = (route: Pick<CashFlowRoute, 'from' | 'to'>) =>
		route.from === accountId || route.to === accountId;
	for (const event of ordered) {
		if (event.batch) {
			const entries = event.entries.sort((a, b) => compareLedgerEntries(b, a));
			const before: CashFlowRoute[] = [];
			const after: CashFlowRoute[] = [];
			const net = new Map<string, Map<string, CashFlowPart>>();
			for (const entry of entries.filter((entry) => entry.type === 'payment')) {
				const previous = pairParts(entry.from, entry.to);
				// The batch records the exact amount it cleared, even when older history is incomplete.
				const parts = total(previous) === entry.amount ? previous : [{ entry, amount: entry.amount }];
				before.push({ ...entry, parts: outstandingParts(parts) });
				const outgoing = net.get(entry.from) ?? new Map();
				const incoming = net.get(entry.to) ?? new Map();
				for (const part of parts) {
					addPart(outgoing, part, 1);
					addPart(incoming, part, -1);
				}
				net.set(entry.from, outgoing);
				net.set(entry.to, incoming);
				record(
					entry,
					parts.map((part) => ({ ...part, amount: -part.amount }))
				);
			}
			for (const entry of entries.filter((entry) => entry.type === 'debt')) {
				const toHub = entry.to === event.batch.hub;
				const parts = [...(net.get(toHub ? entry.from : entry.to)?.values() ?? [])].map((part) => ({
					...part,
					amount: toHub ? part.amount : -part.amount
				}));
				const breakdown = total(parts) === entry.amount ? parts : [{ entry, amount: entry.amount }];
				after.push({ ...entry, parts: outstandingParts(breakdown) });
				record(entry, breakdown);
			}
			const personalBefore = before.filter(involvesAccount);
			const personalAfter = after.filter(involvesAccount);
			if (personalBefore.length || personalAfter.length)
				history.push({ batch: event.batch, before: personalBefore, after: personalAfter });
			continue;
		}
		for (const entry of event.entries) {
			if (entry.source === 'reversal') {
				const original = ledger.get(entry.id.replace(/-undo$/, ''));
				const originalBooking = original && booked.get(original.id);
				if (
					originalBooking &&
					original.from === entry.to &&
					original.to === entry.from &&
					original.amount === entry.amount &&
					original.type === entry.type
				) {
					const pair = record(entry, originalBooking.parts);
					// An undo can reopen a debt that the QR payment had cleared.
					if (pair?.qrCutoff && originalBooking.order <= pair.qrCutoff.order) delete pair.qrCutoff;
					continue;
				}
			}
			let billId = entry.source === 'bill' ? entry.reference : undefined;
			if (!billId && entry.type === 'payment' && entry.source !== 'reversal') {
				const outstanding = outstandingParts(pairParts(entry.from, entry.to));
				const balance = total(outstanding);
				const bills = new Set(outstanding.map((part) => part.billId));
				if (bills.size === 1 && balance >= entry.amount) billId = outstanding[0].billId;
				if (!billId && balance > 0) {
					const billIds = [...totalsByBill(outstanding)].filter(([, amount]) => amount > 0).map(([id]) => id);
					if (billIds.length)
						transferBills.set(entry.id, {
							billIds,
							uncertain: entry.amount !== balance || billIds.length !== bills.size
						});
				}
			}
			if (entry.type === 'payment' && billId)
				transferBills.set(entry.id, { billIds: [billId], uncertain: false });
			const pair = record(entry, [
				{ entry, amount: entry.type === 'debt' ? entry.amount : -entry.amount, billId }
			]);
			if (pair && entry.source === 'qr' && entry.type === 'payment' && total(pair.parts.values()) === 0) {
				// Omit the cleared items from later breakdowns while retaining them for reversals.
				pair.qrCutoff = { order: booked.size - 1, parts: new Map(pair.parts) };
			}
		}
	}
	const cancelled = cancelledEntryIds(state.ledger);
	const since = history[0]?.batch.date;
	const transfers = since
		? state.ledger
				.filter(
					(entry) =>
						entry.type === 'payment' &&
						entry.source !== 'settlement' &&
						entry.source !== 'reversal' &&
						!cancelled.has(entry.id) &&
						entry.from !== entry.to &&
						(entry.from === accountId || entry.to === accountId) &&
						(entry.createdAt ?? entry.date) >= since
				)
				.sort(compareLedgerEntries)
				.map((entry) => ({ entry, billMatches: transferBills.get(entry.id) }))
		: [];
	return { history: history.reverse(), transfers };
}
