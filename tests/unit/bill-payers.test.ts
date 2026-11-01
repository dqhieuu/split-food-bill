import { describe, expect, it } from 'vitest';
import { applyCommand, netBalance, pairBalance } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { billNotificationMessage } from '../../src/lib/domain/notifications';

const now = '2026-10-28T05:00:00.000Z';
const input = {
	id: 'admin-bill',
	payerId: 'linh',
	description: 'Cơm trưa',
	date: now,
	discordNotification: false,
	lines: [
		{ memberId: 'an', amount: 30000, description: 'Cơm', note: '' },
		{ memberId: 'linh', amount: 55000, description: 'Phở', note: '' },
		{ memberId: 'huy', amount: 45000, description: 'Bún', note: '' }
	]
};
const fresh = () => createDemoState(new Date(now));

describe('admin selects a bill payer', () => {
	it('assigns debts and QR links to the selected payer while keeping the admin as creator', () => {
		const state = fresh();
		const before = structuredClone(state.ledger);
		applyCommand(state, 'an', 'createBill', input, now);
		const bill = state.bills.at(-1)!;
		expect(bill).toMatchObject({ organizer: 'linh', creator: 'an', total: 130000 });
		expect(bill).not.toHaveProperty('payerId');
		const entries = state.ledger.filter((entry) => entry.reference === input.id);
		expect(entries).toHaveLength(2);
		expect(
			entries.every((entry) => entry.to === 'linh' && entry.creator === 'an' && entry.from !== entry.to)
		).toBe(true);
		expect(pairBalance(state.ledger, 'an', 'linh')).toBe(pairBalance(before, 'an', 'linh') + 30000);
		expect(pairBalance(state.ledger, 'huy', 'linh')).toBe(pairBalance(before, 'huy', 'linh') + 45000);
		expect(state.audit.at(-1)).toMatchObject({ actor: 'an', action: 'createBill' });
		const message = billNotificationMessage(
			bill,
			{ id: 'lunch', name: 'Lunch' },
			'huy',
			'https://example.test'
		);
		expect(message.embeds[0].description).toContain('/balances?group=lunch&to=linh');
		expect(message.embeds[0].description).toContain('**Người trả hóa đơn:** Thảo Linh');
		expect(message.embeds[0].description).not.toContain('**Người trả hóa đơn:** Minh An');
	});

	it('rejects a forged payer from a non-admin group member without changing state', () => {
		const state = fresh();
		const before = structuredClone(state);
		expect(() => applyCommand(state, 'huy', 'createBill', input, now)).toThrow(
			expect.objectContaining({ status: 403 })
		);
		expect(state).toEqual(before);
	});

	it('allows regular members to explicitly choose themselves', () => {
		const state = fresh();
		applyCommand(state, 'linh', 'createBill', input, now);
		expect(state.bills.at(-1)).toMatchObject({ organizer: 'linh', creator: 'linh' });
	});

	it.each(['missing', 'former'])(
		'rejects an unavailable payer %s before writing the bill or ledger',
		(payerId) => {
			const state = fresh();
			const before = structuredClone(state);
			expect(() => applyCommand(state, 'an', 'createBill', { ...input, payerId }, now)).toThrow();
			expect(state).toEqual(before);
		}
	);

	it('keeps retries idempotent and refuses a different payer or a different bill creator', () => {
		const state = fresh();
		applyCommand(state, 'an', 'createBill', input, now);
		const before = structuredClone(state);
		applyCommand(state, 'an', 'createBill', input, now);
		expect(state).toEqual(before);
		expect(() => applyCommand(state, 'an', 'createBill', { ...input, payerId: 'huy' }, now)).toThrow();
		expect(() => applyCommand(state, 'linh', 'createBill', input, now)).toThrow();
		expect(state).toEqual(before);
	});

	it('preserves everyone’s existing net balance for an already-paid bill with another payer', () => {
		const state = fresh();
		const before = state.members.map((member) => netBalance(state.ledger, member.id));
		applyCommand(state, 'an', 'createBill', { ...input, alreadyPaid: true }, now);
		expect(state.members.map((member) => netBalance(state.ledger, member.id))).toEqual(before);
		const entries = state.ledger.filter((entry) => entry.reference === input.id);
		expect(entries).toHaveLength(4);
		expect(entries.every((entry) => entry.to === 'linh' && entry.creator === 'an')).toBe(true);
	});

	it.each(['an', 'linh'])(
		'lets the payer or a current admin %s undo the bill and restore the original balances',
		(actor) => {
			const state = fresh();
			const before = state.members.map((member) => netBalance(state.ledger, member.id));
			applyCommand(state, 'an', 'createBill', input, now);
			applyCommand(state, actor, 'undoBill', { id: input.id }, now);
			expect(state.members.map((member) => netBalance(state.ledger, member.id))).toEqual(before);
		}
	);

	it('keeps old bills without creator metadata retryable by their original payer', () => {
		const state = fresh();
		applyCommand(state, 'linh', 'createBill', input, now);
		delete state.bills.at(-1)!.creator;
		const before = structuredClone(state);
		applyCommand(state, 'linh', 'createBill', input, now);
		expect(state).toEqual(before);
	});
});
