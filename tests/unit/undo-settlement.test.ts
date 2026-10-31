import { describe, expect, it } from 'vitest';
import { applyCommand, cancelledEntryIds, netBalance, pairBalance } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { personalPaymentHistory } from '../../src/lib/domain/spending';
import type { AppState } from '../../src/lib/domain/types';

const now = '2026-11-01T05:00:00.000Z';
const later = '2026-11-01T06:00:00.000Z';
function withSettlement() {
	const state = createDemoState(new Date(now));
	applyCommand(state, 'an', 'settleDebts', { id: 'simplification', version: state.version }, now);
	return state;
}
function pairs(state: AppState, ledger = state.ledger) {
	return state.members.flatMap((a) => state.members.map((b) => pairBalance(ledger, a.id, b.id)));
}

describe('undoing a debt simplification', () => {
	it('restores every pair and preserves net balances, original records and audit history', () => {
		const original = createDemoState(new Date(now));
		const state = withSettlement();
		const beforeUndo = structuredClone(state);
		const entries = state.ledger.filter((entry) => entry.source === 'settlement');
		expect(new Set(entries.map((entry) => entry.type))).toEqual(new Set(['debt', 'payment']));
		applyCommand(state, 'an', 'undoSettlement', { id: 'simplification' }, later);
		expect(pairs(state)).toEqual(pairs(original));
		expect(state.members.map((member) => netBalance(state.ledger, member.id))).toEqual(
			beforeUndo.members.map((member) => netBalance(beforeUndo.ledger, member.id))
		);
		expect(state.ledger.slice(0, beforeUndo.ledger.length)).toEqual(beforeUndo.ledger);
		const reversals = state.ledger.filter((entry) => entry.source === 'reversal');
		expect(reversals).toHaveLength(entries.length);
		for (const entry of entries)
			expect(reversals).toContainEqual({
				id: `${entry.id}-undo`,
				from: entry.to,
				to: entry.from,
				type: entry.type,
				amount: entry.amount,
				date: later,
				createdAt: later,
				creator: 'an',
				description: `Hoàn tác: ${entry.description}`,
				note: '',
				source: 'reversal',
				reference: 'simplification'
			});
		expect(state.settlements[0]).toMatchObject({ undoneAt: later, undoneBy: 'an' });
		expect(state.audit.at(-1)).toMatchObject({
			actor: 'an',
			action: 'undoSettlement',
			reference: 'simplification'
		});
		expect(state.version).toBe(beforeUndo.version + 1);
	});
	it('reverses only the selected batch while preserving later payments, bills and simplifications', () => {
		const state = withSettlement();
		applyCommand(
			state,
			'an',
			'recordPayment',
			{ id: 'later-payment', to: 'linh', amount: 1000, description: 'Trả sau tối giản', note: '' },
			later
		);
		applyCommand(
			state,
			'huy',
			'createBill',
			{
				id: 'later-bill',
				description: 'Cơm mới',
				date: later,
				discordNotification: false,
				lines: [{ memberId: 'linh', amount: 15000, description: 'Cơm', note: '' }]
			},
			later
		);
		applyCommand(state, 'an', 'settleDebts', { id: 'second', version: state.version }, later);
		const before = structuredClone(state);
		const expected = before.ledger.filter(
			(entry) => !(entry.source === 'settlement' && entry.reference === 'simplification')
		);
		applyCommand(state, 'an', 'undoSettlement', { id: 'simplification' }, later);
		expect(pairs(state)).toEqual(pairs(before, expected));
		expect(state.ledger.slice(0, before.ledger.length)).toEqual(before.ledger);
		expect(state.bills).toEqual(before.bills);
		expect(state.settlements.find((batch) => batch.id === 'second')).toEqual(
			before.settlements.find((batch) => batch.id === 'second')
		);
	});
	it('makes retries idempotent and still checks admin permission before acknowledging a retry', () => {
		const state = withSettlement();
		applyCommand(state, 'an', 'undoSettlement', { id: 'simplification' }, later);
		const before = structuredClone(state);
		expect(applyCommand(state, 'an', 'undoSettlement', { id: 'simplification' }, later)).toEqual({
			reference: 'simplification'
		});
		expect(state).toEqual(before);
		expect(() => applyCommand(state, 'linh', 'undoSettlement', { id: 'simplification' }, later)).toThrow(
			expect.objectContaining({ status: 403 })
		);
		expect(state).toEqual(before);
	});
	it.each(['member', 'inactive', 'missing'])(
		'rejects an unauthorized %s actor without changing state',
		(kind) => {
			const state = withSettlement();
			if (kind === 'inactive') state.members.find((member) => member.id === 'an')!.active = false;
			const actor = kind === 'member' ? 'linh' : kind === 'missing' ? 'missing' : 'an';
			const before = structuredClone(state);
			expect(() => applyCommand(state, actor, 'undoSettlement', { id: 'simplification' }, later)).toThrow();
			expect(state).toEqual(before);
		}
	);
	it.each(['unknown', 'missing-entries', 'count-mismatch', 'id-collision'])(
		'rejects %s batches before adding any reversals',
		(kind) => {
			const state = withSettlement();
			if (kind === 'missing-entries')
				state.ledger = state.ledger.filter((entry) => entry.source !== 'settlement');
			if (kind === 'count-mismatch') state.settlements[0].entryCount++;
			if (kind === 'id-collision')
				state.ledger.push({ ...state.ledger[0], id: 'simplification-0-undo', source: 'manual' });
			const before = structuredClone(state);
			expect(() =>
				applyCommand(
					state,
					'an',
					'undoSettlement',
					{ id: kind === 'unknown' ? 'missing' : 'simplification' },
					later
				)
			).toThrow(expect.objectContaining({ status: kind === 'unknown' ? 404 : 409 }));
			expect(state).toEqual(before);
		}
	);
	it('keeps synthetic settlement and reversal entries out of personal payment history', () => {
		const state = withSettlement();
		const activeIds = new Set(state.members.filter((member) => member.active).map((member) => member.id));
		const before = personalPaymentHistory(state.ledger, 'an', activeIds);
		applyCommand(state, 'an', 'undoSettlement', { id: 'simplification' }, later);
		expect(personalPaymentHistory(state.ledger, 'an', activeIds)).toEqual(before);
		const cancelled = cancelledEntryIds(state.ledger);
		for (const entry of state.ledger.filter((entry) => entry.reference === 'simplification'))
			expect(cancelled.has(entry.id)).toBe(true);
	});
});
