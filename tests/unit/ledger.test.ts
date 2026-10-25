import { describe, expect, it } from 'vitest';
import {
	applyCommand,
	pairBalance,
	netBalance,
	settlementPlan,
	splitAmount,
	receiptHtml
} from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { parseLedgerImport } from '../../src/lib/domain/import';
import { crc16, vietQrPayload, resolveBank } from '../../src/lib/domain/qr';

const now = '2026-10-25T12:00:00.000Z';
const fresh = () => createDemoState(new Date(now));
describe('ledger accounting', () => {
	it('nets debt and repayment in both directions, including self and zero legacy rows', () => {
		const state = fresh();
		state.ledger = [];
		const base = {
			date: now,
			description: 'Sample',
			note: '',
			creator: 'an',
			source: 'import' as const,
			reference: 'legacy'
		};
		state.ledger = [
			{ ...base, id: 'a', from: 'an', to: 'linh', type: 'debt', amount: 100000 },
			{ ...base, id: 'b', from: 'an', to: 'linh', type: 'payment', amount: 25000 },
			{ ...base, id: 'c', from: 'linh', to: 'an', type: 'debt', amount: 40000 },
			{ ...base, id: 'd', from: 'linh', to: 'an', type: 'payment', amount: 10000 },
			{ ...base, id: 'e', from: 'an', to: 'an', type: 'debt', amount: 99999 },
			{ ...base, id: 'f', from: 'an', to: 'linh', type: 'debt', amount: 0 }
		];
		expect(pairBalance(state.ledger, 'an', 'linh')).toBe(45000);
		expect(pairBalance(state.ledger, 'linh', 'an')).toBe(-45000);
		expect(netBalance(state.ledger, 'an')).toBe(-45000);
		expect(netBalance(state.ledger, 'linh')).toBe(45000);
	});
	it('preserves every net position across hub reassignment and never adds self debt', () => {
		for (let sample = 1; sample <= 40; sample++) {
			const state = fresh();
			for (let i = 0; i < state.ledger.length; i++)
				state.ledger[i].amount = ((i * sample * 7919) % 200001) - 40000;
			const before = state.members.map((m) => netBalance(state.ledger, m.id));
			const plan = settlementPlan(state);
			applyCommand(state, 'an', 'settleDebts', { id: `settle-${sample}`, version: state.version }, now);
			expect(state.members.map((m) => netBalance(state.ledger, m.id))).toEqual(before);
			expect(before.reduce((s, n) => s + n, 0)).toBe(0);
			expect(state.ledger.filter((e) => e.source === 'settlement').every((e) => e.from !== e.to)).toBe(true);
			expect(plan.hub).toBe(state.members[before.indexOf(Math.min(...before))].id);
		}
	});
	it('posts a bill once, includes the payer meal only in the bill, and queues a receipt', () => {
		const state = fresh();
		const before = state.ledger.length;
		const version = state.version;
		const input = {
			id: 'test-bill',
			description: 'Lunch',
			date: now,
			emailReceipt: true,
			lines: [
				{ memberId: 'an', amount: 55000, description: '', note: '' },
				{ memberId: 'linh', amount: 60000, description: 'Noodles', note: 'No chili' }
			]
		};
		applyCommand(state, 'an', 'createBill', input, now);
		applyCommand(state, 'an', 'createBill', input, now);
		expect(state.ledger.length).toBe(before + 1);
		expect(state.version).toBe(version + 1);
		expect(state.bills.find((b) => b.id === input.id)?.total).toBe(115000);
		expect(state.receipts.filter((r) => r.billId === input.id)).toHaveLength(1);
		const balance = netBalance(state.ledger, 'an');
		applyCommand(state, 'an', 'simulateReceipt', { id: input.id, fail: true }, now);
		applyCommand(state, 'an', 'simulateReceipt', { id: input.id, fail: false }, now);
		expect(netBalance(state.ledger, 'an')).toBe(balance);
		expect(state.ledger.length).toBe(before + 1);
	});
	it('rejects non-admin settlement and stale preview versions', () => {
		expect(() => applyCommand(fresh(), 'linh', 'settleDebts', { id: 'bad', version: 1 }, now)).toThrow();
		expect(() => applyCommand(fresh(), 'an', 'settleDebts', { id: 'bad', version: 0 }, now)).toThrow();
	});
	it('splits every whole VND exactly, with stable remainder allocation', () => {
		expect(splitAmount(5, [1, 1, 1])).toEqual([2, 2, 1]);
		expect(splitAmount(100, [1, 2, 3])).toEqual([17, 33, 50]);
		for (let amount = 1; amount < 1000; amount += 7)
			for (let count = 1; count < 15; count++)
				expect(splitAmount(amount, Array(count).fill(1)).reduce((s, n) => s + n, 0)).toBe(amount);
	});
});
describe('payments', () => {
	it('records multiple repayments together and is idempotent', () => {
		const state = fresh();
		const before = state.ledger.length;
		const input = {
			id: 'repayment-batch',
			description: 'Repayment batch',
			note: '',
			payments: [
				{ to: 'linh', amount: 55000 },
				{ to: 'huy', amount: 35000 }
			]
		};
		applyCommand(state, 'an', 'recordPayments', input, now);
		applyCommand(state, 'an', 'recordPayments', input, now);
		expect(state.ledger.length).toBe(before + 2);
		expect(
			state.ledger
				.filter((entry) => entry.reference === input.id)
				.reduce((sum, entry) => sum + entry.amount, 0)
		).toBe(90000);
		expect(() =>
			applyCommand(
				state,
				'an',
				'recordPayments',
				{
					...input,
					id: 'invalid',
					payments: [
						{ to: 'linh', amount: 1 },
						{ to: 'linh', amount: 2 }
					]
				},
				now
			)
		).toThrow();
	});
	function prepare() {
		const state = fresh();
		state.ledger = [
			{
				id: 'debt',
				from: 'an',
				to: 'linh',
				type: 'debt',
				amount: 65000,
				date: now,
				description: 'Lunch',
				note: '',
				creator: 'linh',
				source: 'manual',
				reference: 'test'
			}
		];
		return state;
	}
	it('records a QR confirmation directly, with no pending request or expiry, exactly once', () => {
		const state = prepare();
		const input = { id: 'qr-payment', to: 'linh', amount: 65000 };
		applyCommand(state, 'an', 'confirmQrPayment', input, '2026-10-26T12:00:00.000Z');
		const version = state.version;
		applyCommand(state, 'an', 'confirmQrPayment', input, '2026-10-27T12:00:00.000Z');
		expect(pairBalance(state.ledger, 'an', 'linh')).toBe(0);
		expect(state.ledger.filter((entry) => entry.source === 'qr')).toHaveLength(1);
		expect(state.version).toBe(version);
	});
	it('records the scanned amount after intervening ledger changes and settlement', () => {
		const state = prepare();
		applyCommand(
			state,
			'an',
			'recordPayment',
			{ id: 'partial', to: 'linh', amount: 1000, description: 'Part', note: '' },
			now
		);
		applyCommand(state, 'an', 'settleDebts', { id: 'settlement', version: state.version }, now);
		const before = netBalance(state.ledger, 'an');
		applyCommand(state, 'an', 'confirmQrPayment', { id: 'qr-payment', to: 'linh', amount: 65000 }, now);
		expect(netBalance(state.ledger, 'an')).toBe(before + 65000);
	});
	it('rejects self payments and conflicting retries without adding extra ledger entries', () => {
		const state = prepare();
		const input = { id: 'qr-payment', to: 'linh', amount: 65000 };
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', { ...input, to: 'an' }, now)).toThrow();
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', { ...input, to: 'missing' }, now)).toThrow();
		applyCommand(state, 'an', 'confirmQrPayment', input, now);
		expect(() => applyCommand(state, 'an', 'confirmQrPayment', { ...input, amount: 64000 }, now)).toThrow();
		expect(() => applyCommand(state, 'huy', 'confirmQrPayment', input, now)).toThrow();
		expect(state.ledger.filter((entry) => entry.source === 'qr')).toHaveLength(1);
	});
});

describe('migration and receipts', () => {
	it('preserves former members, zero and self rows, with repeatable imports', () => {
		const rows = parseLedgerImport(
			'sequence,from,to,type,amount,date,description,note\r\n24,former.person,an,Nợ,0,2026-01-01T12:00:00+07:00,"Lunch, team","Quoted ""note"""\r\n25,former.person,former.person,Trả,55000,2026-01-01T12:00:00+07:00,Self,'
		);
		const state = fresh();
		const before = state.ledger.length;
		applyCommand(state, 'an', 'importLedger', { entries: rows }, now);
		applyCommand(state, 'an', 'importLedger', { entries: rows }, now);
		expect(state.ledger.length).toBe(before + 2);
		expect(state.members.find((m) => m.id === 'former.person')?.active).toBe(false);
		expect(rows[0].note).toBe('Quoted "note"');
		expect(rows[0].description).toBe('Lunch, team');
	});
	it('rejects ambiguous dates, duplicate IDs, missing amounts and conflicting existing records', () => {
		const entry = { id: 'one', from: 'an', to: 'linh', type: 'debt', amount: 1, date: now };
		expect(() => parseLedgerImport(JSON.stringify([entry, entry]))).toThrow();
		expect(() => parseLedgerImport(JSON.stringify([{ ...entry, date: '2026-01-01' }]))).toThrow();
		expect(() => parseLedgerImport(JSON.stringify([{ ...entry, date: '2026-01-01T12:00:00' }]))).toThrow();
		expect(() => parseLedgerImport(JSON.stringify([{ ...entry, amount: '' }]))).toThrow();
		expect(() => parseLedgerImport(JSON.stringify([{ ...entry, id: '' }]))).toThrow();
		const state = fresh();
		const rows = parseLedgerImport(JSON.stringify([entry]));
		applyCommand(state, 'an', 'importLedger', { entries: rows }, now);
		expect(() =>
			applyCommand(state, 'an', 'importLedger', { entries: [{ ...rows[0], amount: 2 }] }, now)
		).toThrow();
	});
	it('escapes receipt content and freezes participant names at posting time', () => {
		const state = fresh();
		applyCommand(
			state,
			'an',
			'createBill',
			{
				id: 'escape',
				description: '<img src=x onerror=alert(1)>',
				date: now,
				emailReceipt: true,
				lines: [{ memberId: 'an', amount: 1, description: '<script>bad</script>', note: '& " >' }]
			},
			now
		);
		const bill = state.bills.find((b) => b.id === 'escape')!;
		state.members.find((m) => m.id === 'an')!.name = 'Changed';
		const html = receiptHtml(bill, state.members);
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img src=x');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('Minh An');
		expect(html).not.toContain('Changed');
	});
	it('generates an offline VietQR payload with a verified checksum', () => {
		expect(crc16('123456789')).toBe('29B1');
		const payload = vietQrPayload('970436', '00000123', 55000, 'LUNCH TEST');
		expect(payload).toContain('00000123');
		expect(payload).toContain('A000000727');
		expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
	});
	it('resolves suggested banks to QR codes and preserves arbitrary bank text without a fabricated code', () => {
		expect(resolveBank('  vIet com bank ')).toEqual({ code: '970436', label: 'Vietcombank' });
		expect(resolveBank('970422')).toEqual({ code: '970422', label: 'MB Bank' });
		const state = fresh();
		const member = state.members.find((member) => member.id === 'linh')!;
		applyCommand(state, 'an', 'saveMember', { ...member, bankLabel: 'Ngân hàng nội bộ' }, now);
		expect(state.members.find((member) => member.id === 'linh')).toMatchObject({
			bankLabel: 'Ngân hàng nội bộ',
			bankCode: ''
		});
	});
});
