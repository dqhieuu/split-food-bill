import { describe, expect, it } from 'vitest';
import { applyCommand, cancelledEntryIds, netBalance, pairBalance } from '../../src/lib/domain/ledger';
import { personalPaymentHistory } from '../../src/lib/domain/spending';
import { createDemoState } from '../../src/lib/domain/seed';

const now = '2026-10-27T05:00:00.000Z';
const later = '2026-10-27T06:00:00.000Z';
function withBill(organizer = 'linh') {
	const state = createDemoState(new Date(now));
	applyCommand(
		state,
		organizer,
		'createBill',
		{
			id: 'lunch',
			description: 'Cơm trưa',
			date: now,
			discordNotification: false,
			lines: [
				{ memberId: organizer, amount: 30000, description: '', note: '' },
				{ memberId: 'huy', amount: 40000, description: '', note: '' },
				{ memberId: 'mai', amount: 50000, description: '', note: '' }
			]
		},
		now
	);
	return state;
}

describe('undoing a bill', () => {
	it('appends opposite entries that restore every balance without deleting history', () => {
		const state = withBill();
		const before = createDemoState(new Date(now));
		const originalIds = state.ledger.map((entry) => entry.id);
		applyCommand(state, 'linh', 'undoBill', { id: 'lunch' }, later);
		expect(state.ledger.map((entry) => entry.id)).toEqual(expect.arrayContaining(originalIds));
		const reversals = state.ledger.filter((entry) => entry.source === 'reversal');
		expect(reversals).toHaveLength(2);
		expect(reversals[0]).toMatchObject({
			id: 'lunch-1-undo',
			from: 'linh',
			to: 'huy',
			type: 'debt',
			amount: 40000,
			reference: 'lunch',
			creator: 'linh',
			date: later
		});
		for (const member of state.members)
			expect(netBalance(state.ledger, member.id)).toBe(netBalance(before.ledger, member.id));
		expect(pairBalance(state.ledger, 'huy', 'linh')).toBe(pairBalance(before.ledger, 'huy', 'linh'));
		expect(state.bills.find((bill) => bill.id === 'lunch')).toMatchObject({
			undoneAt: later,
			undoneBy: 'linh'
		});
	});
	it('rejects undoing the same bill a second time', () => {
		const state = withBill();
		applyCommand(state, 'linh', 'undoBill', { id: 'lunch' }, later);
		const ledgerSize = state.ledger.length;
		expect(() => applyCommand(state, 'an', 'undoBill', { id: 'lunch' }, later)).toThrow(
			expect.objectContaining({ status: 409 })
		);
		expect(state.ledger).toHaveLength(ledgerSize);
	});
	it('offers no way to undo the undo: reversals are not bills and the bill id cannot be reused', () => {
		const state = withBill();
		applyCommand(state, 'linh', 'undoBill', { id: 'lunch' }, later);
		expect(() => applyCommand(state, 'linh', 'undoBill', { id: 'lunch-1-undo' }, later)).toThrow(
			expect.objectContaining({ status: 404 })
		);
		const ledgerSize = state.ledger.length;
		applyCommand(
			state,
			'linh',
			'createBill',
			{
				id: 'lunch',
				description: 'Cơm trưa',
				date: now,
				discordNotification: false,
				lines: [{ memberId: 'huy', amount: 40000, description: '', note: '' }]
			},
			later
		);
		expect(state.ledger).toHaveLength(ledgerSize);
		expect(state.bills.find((bill) => bill.id === 'lunch')?.undoneAt).toBe(later);
	});
	it('lets only the payer or a group admin undo', () => {
		expect(() => applyCommand(withBill(), 'huy', 'undoBill', { id: 'lunch' }, later)).toThrow(
			expect.objectContaining({ status: 403 })
		);
		expect(() => applyCommand(withBill(), 'an', 'undoBill', { id: 'lunch' }, later)).not.toThrow();
	});
	it('hides cancelled debts and their reversals from personal history', () => {
		const state = withBill();
		applyCommand(state, 'linh', 'undoBill', { id: 'lunch' }, later);
		const cancelled = cancelledEntryIds(state.ledger);
		expect([...cancelled].sort()).toEqual(['lunch-1', 'lunch-1-undo', 'lunch-2', 'lunch-2-undo']);
		const history = personalPaymentHistory(state.ledger, 'huy', new Set(state.members.map((m) => m.id)));
		expect(history.some((item) => item.entry.reference === 'lunch')).toBe(false);
	});
});
