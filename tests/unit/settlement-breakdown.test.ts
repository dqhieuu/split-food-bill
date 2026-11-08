import { describe, expect, it } from 'vitest';
import { applyCommand, pairBalance } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { settlementBreakdown, type CashFlowRoute } from '../../src/lib/domain/settlement-breakdown';
import type { AppState } from '../../src/lib/domain/types';

const date = (hour: number) => `2026-11-08T${String(hour).padStart(2, '0')}:00:00.000Z`;

function bill(state: AppState, id: string, from: string, to: string, amount: number, hour = 1) {
	applyCommand(
		state,
		to,
		'createBill',
		{
			id,
			description: id,
			date: date(hour),
			discordNotification: false,
			lines: [{ memberId: from, amount, description: id, note: '' }]
		},
		date(hour)
	);
}

function settle(state: AppState, hour: number) {
	applyCommand(state, 'an', 'settleDebts', { id: `batch-${hour}`, version: state.version }, date(hour));
}

function initial() {
	const state = createDemoState(new Date(date(1)));
	state.ledger = [];
	state.bills = [];
	bill(state, 'com', 'an', 'linh', 100000);
	bill(state, 'bun', 'huy', 'linh', 60000);
	return state;
}

const items = (route: CashFlowRoute) => route.parts.map(({ billId, amount }) => [billId, amount]);

describe('settlement breakdown', () => {
	it('retains bill origins on the hub’s two routes and avoids duplication after repeating the batch', () => {
		const state = initial();
		settle(state, 2);
		const first = settlementBreakdown(state, 'an');
		expect(first[0].after.map(items)).toEqual([
			[['bun', 60000]],
			[
				['com', 100000],
				['bun', 60000]
			]
		]);
		settle(state, 3);
		for (const entry of state.ledger) delete entry.settlementStep;
		state.ledger.reverse();
		const repeated = settlementBreakdown(state, 'an');
		expect(repeated[0].after.map(items)).toEqual(first[0].after.map(items));
		expect(repeated.map(({ batch }) => batch.id)).toEqual(['batch-3', 'batch-2']);
	});

	it('moves only the unpaid amount when a new bill changes the hub', () => {
		const state = initial();
		settle(state, 2);
		applyCommand(state, 'huy', 'confirmQrPayment', { id: 'partial', to: 'an', amount: 20000 }, date(3));
		settle(state, 4);
		const partial = settlementBreakdown(state, 'huy');
		expect(partial[0].after[0]).toMatchObject({ from: 'huy', to: 'an', amount: 40000 });
		expect(items(partial[0].after[0])).toEqual([
			['bun', 60000],
			['bun', -20000]
		]);
		bill(state, 'lau', 'mai', 'linh', 150000, 5);
		settle(state, 6);
		const huy = settlementBreakdown(state, 'huy');
		expect(huy[0].after[0]).toMatchObject({ from: 'huy', to: 'mai', amount: 40000 });
		const an = settlementBreakdown(state, 'an');
		expect(an[0].after[0]).toMatchObject({ from: 'an', to: 'mai', amount: 120000 });
		expect(items(an[0].after[0])).toEqual(
			expect.arrayContaining([
				['com', 100000],
				['bun', 20000]
			])
		);
		expect(items(settlementBreakdown(state, 'linh')[0].after[0])).toEqual(
			expect.arrayContaining([
				['com', 100000],
				['bun', 60000],
				['lau', 150000]
			])
		);
	});

	it('keeps a combined payment unallocated when it could cover multiple bills', () => {
		const state = initial();
		settle(state, 2);
		applyCommand(state, 'an', 'confirmQrPayment', { id: 'combined', to: 'linh', amount: 130000 }, date(3));
		settle(state, 4);
		const linh = settlementBreakdown(state, 'linh');
		expect(linh[0].after[0]).toMatchObject({ from: 'huy', to: 'linh', amount: 30000 });
		expect(items(linh[0].after[0])).toEqual([
			['com', 100000],
			['bun', 60000],
			[undefined, -130000]
		]);
	});

	it('cuts off cleared bills after a full QR payment and keeps the older batch and other pairs', () => {
		const state = initial();
		settle(state, 2);
		applyCommand(state, 'an', 'confirmQrPayment', { id: 'full', to: 'linh', amount: 160000 }, date(3));
		bill(state, 'lau', 'an', 'linh', 25000, 4);

		settle(state, 5);
		const next = settlementBreakdown(state, 'linh');
		const anBefore = settlementBreakdown(state, 'an')[0].before;
		expect(anBefore.find((route) => route.from === 'huy')?.amount).toBe(60000);
		expect(next[0].before.map(items)).toEqual([[['lau', 25000]]]);
		expect(next[0].after.map(items)).toEqual([[['lau', 25000]]]);
		expect(next[1].after.flatMap(items)).toEqual([
			['com', 100000],
			['bun', 60000]
		]);
	});

	it('restores the original bill and shows the refund when undoing a batch cleared by QR', () => {
		const state = initial();
		settle(state, 2);
		applyCommand(state, 'huy', 'confirmQrPayment', { id: 'full', to: 'an', amount: 60000 }, date(3));
		applyCommand(state, 'an', 'undoSettlement', { id: 'batch-2' }, date(4));
		settle(state, 5);

		const { before } = settlementBreakdown(state, 'huy')[0];
		expect(before).toMatchObject([
			{ from: 'an', to: 'huy', amount: 60000, parts: [{ entry: { id: 'qr-full' } }] },
			{ from: 'huy', to: 'linh', amount: 60000, parts: [{ billId: 'bun' }] }
		]);
	});

	it('shows the offset bills when no current transfers are due', () => {
		const state = initial();
		bill(state, 'lau', 'linh', 'mai', 160000);
		settle(state, 2);
		const [flow] = settlementBreakdown(state, 'linh');
		expect(flow.after).toEqual([]);
		expect(flow.before.flatMap(items)).toEqual(
			expect.arrayContaining([
				['com', 100000],
				['bun', 60000],
				['lau', 160000]
			])
		);
	});

	it('keeps payments and later batch balances when an older batch is undone', () => {
		const state = initial();
		settle(state, 2);
		applyCommand(state, 'huy', 'confirmQrPayment', { id: 'partial', to: 'an', amount: 20000 }, date(3));
		const laterBatch = structuredClone(state);
		bill(laterBatch, 'lau', 'mai', 'linh', 150000, 4);
		settle(laterBatch, 5);
		applyCommand(laterBatch, 'an', 'undoSettlement', { id: 'batch-2' }, date(6));
		applyCommand(state, 'an', 'undoSettlement', { id: 'batch-2' }, date(4));
		const restored = settlementBreakdown(state, 'huy');
		expect(restored[0].batch.undoneAt).toBe(date(4));
		const previousLedger = [...laterBatch.ledger];
		settle(laterBatch, 7);
		for (const member of laterBatch.members) {
			const batch = settlementBreakdown(laterBatch, member.id).find(({ batch }) => batch.id === 'batch-7');
			for (const other of laterBatch.members.filter((other) => other.id !== member.id)) {
				const route = batch?.before.find((route) => route.from === other.id || route.to === other.id);
				const balance = route ? route.amount * (route.from === member.id ? 1 : -1) : 0;
				expect(balance).toBe(pairBalance(previousLedger, member.id, other.id));
			}
		}
	});
});
