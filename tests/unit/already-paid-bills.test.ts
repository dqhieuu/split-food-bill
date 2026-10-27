import { describe, expect, it } from 'vitest';
import { applyCommand, cancelledEntryIds, netBalance, pairBalance } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { calendarMonth } from '../../src/lib/domain/calendar';
import { personalPaymentHistory, spendingWindow } from '../../src/lib/domain/spending';

const now = '2026-10-28T05:00:00.000Z';
const input = {
	id: 'paid-bill',
	description: 'Bữa trưa đã thanh toán',
	date: '2026-10-26T05:00:00.000Z',
	alreadyPaid: true,
	discordNotification: false,
	lines: [
		{ memberId: 'an', amount: 30000, description: 'Cơm', note: '' },
		{ memberId: 'linh', amount: 55000, description: 'Phở', note: '' },
		{ memberId: 'huy', amount: 45000, description: 'Bún', note: '' }
	]
};
const fresh = () => createDemoState(new Date(now));

describe('already-paid bills', () => {
	it('writes a debt and matching repayment per non-payer participant without changing existing balances', () => {
		const state = fresh();
		const before = structuredClone(state);
		applyCommand(state, 'an', 'createBill', input, now);
		const entries = state.ledger.filter((entry) => entry.reference === input.id);
		expect(entries).toHaveLength(4);
		for (const line of input.lines.slice(1)) {
			const pair = entries.filter((entry) => entry.from === line.memberId);
			expect(pair.map((entry) => entry.type)).toEqual(['debt', 'payment']);
			for (const entry of pair)
				expect(entry).toMatchObject({
					to: 'an',
					amount: line.amount,
					date: input.date,
					createdAt: now,
					source: 'bill',
					creator: 'an'
				});
			expect(pair[1].description).toBe(`Đã thanh toán: ${line.description}`);
			expect(pair[1].note).toBe('');
		}
		expect(state.ledger.slice(0, before.ledger.length)).toEqual(before.ledger);
		for (const from of state.members)
			for (const to of state.members) {
				expect(pairBalance(state.ledger, from.id, to.id)).toBe(pairBalance(before.ledger, from.id, to.id));
			}
		expect(state.bills.at(-1)).toMatchObject({ alreadyPaid: true, total: 130000 });
	});

	it.each([undefined, false])('keeps ordinary bill behavior when alreadyPaid is %s', (alreadyPaid) => {
		const state = fresh();
		const before = pairBalance(state.ledger, 'linh', 'an');
		applyCommand(state, 'an', 'createBill', { ...input, alreadyPaid }, now);
		const entries = state.ledger.filter((entry) => entry.reference === input.id);
		expect(entries).toHaveLength(2);
		expect(entries.every((entry) => entry.type === 'debt')).toBe(true);
		expect(pairBalance(state.ledger, 'linh', 'an')).toBe(before + 55000);
	});

	it('keeps retries idempotent and rejects changing the paid status of an already recorded bill', () => {
		const state = fresh();
		applyCommand(state, 'an', 'createBill', input, now);
		const after = structuredClone(state);
		applyCommand(state, 'an', 'createBill', input, now);
		expect(state).toEqual(after);
		expect(() => applyCommand(state, 'an', 'createBill', { ...input, alreadyPaid: false }, now)).toThrow(
			expect.objectContaining({ status: 409 })
		);
		expect(state).toEqual(after);
	});

	it.each(['paid-bill-1', 'paid-bill-1-paid'])(
		'rejects a collision with %s before writing anything',
		(id) => {
			const state = fresh();
			state.ledger.push({ ...state.ledger[0], id });
			const before = structuredClone(state);
			expect(() => applyCommand(state, 'an', 'createBill', input, now)).toThrow();
			expect(state).toEqual(before);
		}
	);

	it('undoes both sides without introducing a debt and hides all cancelled entries from personal history', () => {
		const state = fresh();
		applyCommand(state, 'an', 'createBill', input, now);
		const before = structuredClone(state);
		applyCommand(state, 'an', 'undoBill', { id: input.id }, now);
		const reversals = state.ledger.filter(
			(entry) => entry.reference === input.id && entry.source === 'reversal'
		);
		expect(reversals).toHaveLength(4);
		expect(reversals.filter((entry) => entry.type === 'payment')).toHaveLength(2);
		for (const member of state.members)
			expect(netBalance(state.ledger, member.id)).toBe(netBalance(before.ledger, member.id));
		const cancelled = cancelledEntryIds(state.ledger);
		expect(
			state.ledger.filter((entry) => entry.reference === input.id).every((entry) => cancelled.has(entry.id))
		).toBe(true);
		const history = personalPaymentHistory(
			state.ledger,
			'linh',
			new Set(state.members.map((member) => member.id))
		);
		expect(history.some((item) => item.entry.reference === input.id)).toBe(false);
	});

	it('counts the bill once in spending and calendar totals despite two ledger entries per share', () => {
		const state = fresh();
		const calendarBefore = calendarMonth(state.bills, '2026-10', (bill) => bill.organizer).monthTotal;
		const spendingBefore = spendingWindow(state.bills, 'month', 0, '2026-10-28').buckets.at(-1)!.value;
		applyCommand(state, 'an', 'createBill', input, now);
		expect(calendarMonth(state.bills, '2026-10', (bill) => bill.organizer).monthTotal).toBe(
			calendarBefore + 130000
		);
		expect(spendingWindow(state.bills, 'month', 0, '2026-10-28').buckets.at(-1)!.value).toBe(
			spendingBefore + 130000
		);
	});

	it('allows regular members to log already-paid bills and avoids self-transfers', () => {
		const state = fresh();
		applyCommand(state, 'linh', 'createBill', input, now);
		const entries = state.ledger.filter((entry) => entry.reference === input.id);
		expect(entries).toHaveLength(4);
		expect(entries.every((entry) => entry.from !== entry.to && entry.creator === 'linh')).toBe(true);
		applyCommand(state, 'linh', 'createBill', { ...input, id: 'solo', lines: [input.lines[1]] }, now);
		expect(state.bills.at(-1)).toMatchObject({ id: 'solo', alreadyPaid: true, total: 55000 });
		expect(state.ledger.some((entry) => entry.reference === 'solo')).toBe(false);
	});
});
