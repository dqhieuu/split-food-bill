import { describe, expect, it } from 'vitest';
import { applyCommand, pairBalance } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';

const now = '2026-10-28T05:00:00.000Z';
const input = { id: 'admin-qr', from: 'linh', to: 'an', amount: 65000 };

function fixture() {
	const state = createDemoState(new Date(now));
	state.ledger = [
		{
			id: 'lunch',
			from: 'linh',
			to: 'an',
			amount: 65000,
			type: 'debt',
			date: now,
			description: 'Cơm trưa',
			note: '',
			creator: 'an',
			source: 'bill',
			reference: 'lunch'
		}
	];
	return state;
}

describe('admin payment actions on another member’s balance page', () => {
	it('uses the selected member as payer and the logged-in admin as creator', () => {
		const state = fixture();
		const original = structuredClone(state.ledger);
		applyCommand(state, 'an', 'confirmQrPayment', input, now);
		expect(pairBalance(state.ledger, 'linh', 'an')).toBe(0);
		expect(state.ledger.slice(0, 1)).toEqual(original);
		expect(state.ledger.at(-1)).toMatchObject({
			from: 'linh',
			to: 'an',
			amount: 65000,
			type: 'payment',
			creator: 'an',
			source: 'qr',
			note: '',
			description: 'Quản trị viên xác nhận thanh toán bằng QR'
		});
		expect(state.audit.at(-1)).toMatchObject({ actor: 'an', action: 'confirmQrPayment' });
	});

	it('rejects a forged payer from a regular group member before changing state', () => {
		const state = fixture();
		const before = structuredClone(state);
		expect(() => applyCommand(state, 'huy', 'confirmQrPayment', input, now)).toThrow(
			expect.objectContaining({ status: 403 })
		);
		expect(state).toEqual(before);
	});

	it('keeps regular members able to pay from their own account', () => {
		const state = fixture();
		applyCommand(state, 'linh', 'confirmQrPayment', { ...input, id: 'own-qr', from: undefined }, now);
		expect(pairBalance(state.ledger, 'linh', 'an')).toBe(0);
		expect(state.ledger.at(-1)).toMatchObject({
			from: 'linh',
			to: 'an',
			creator: 'linh',
			description: 'Auto trả tiền bằng QR'
		});
	});

	it('makes retries idempotent and rejects changing the payer or admin for an existing payment ID', () => {
		const state = fixture();
		applyCommand(state, 'an', 'confirmQrPayment', input, now);
		const after = structuredClone(state);
		applyCommand(state, 'an', 'confirmQrPayment', input, now);
		expect(state).toEqual(after);
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', { ...input, from: 'huy' }, now)).toThrow();
		expect(state).toEqual(after);
		state.members.find((member) => member.id === 'huy')!.role = 'admin';
		expect(() => applyCommand(state, 'huy', 'confirmQrPayment', input, now)).toThrow();
		expect(state.ledger).toEqual(after.ledger);
	});

	it('checks group role again when an admin loses permission before a retry', () => {
		const state = fixture();
		applyCommand(state, 'an', 'confirmQrPayment', input, now);
		state.members.find((member) => member.id === 'an')!.role = 'member';
		const before = structuredClone(state);
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', input, now)).toThrow(
			expect.objectContaining({ status: 403 })
		);
		expect(state).toEqual(before);
	});

	it('rejects a missing payer, payer paying themself, or the removed receipt-confirmation command', () => {
		const state = fixture();
		const before = structuredClone(state);
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', { ...input, from: 'missing' }, now)).toThrow();
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', { ...input, to: 'linh' }, now)).toThrow();
		expect(() =>
			applyCommand(state, 'an', 'confirmReceivedPayment', { id: 'old', from: 'linh', amount: 65000 }, now)
		).toThrow();
		expect(state).toEqual(before);
	});
});
