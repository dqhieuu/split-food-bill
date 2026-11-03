import { describe, expect, it } from 'vitest';
import {
	applyCommand,
	pairBalance,
	netBalance,
	settlementPlan,
	compareLedgerEntries,
	compareBillsByCreatedAt,
	splitAmount,
	dateTimeLabel,
	billDateLabel
} from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { parseLedgerImport } from '../../src/lib/domain/import';
import { crc16, vietQrPayload, resolveBank, qrPaymentMessage } from '../../src/lib/domain/qr';

const now = '2026-10-25T12:00:00.000Z';
const fresh = () => createDemoState(new Date(now));
describe('creation timestamps', () => {
	it('includes the Vietnam-local weekday in bill dates', () => {
		expect(billDateLabel('2026-10-25T05:00:00Z')).toContain('Chủ Nhật');
		expect(billDateLabel('2026-10-25T17:00:00Z')).toContain('Thứ Hai');
		expect(billDateLabel('2026-10-25T17:00:00Z')).toContain('26/10/2026');
	});
	it('stores server creation separately from payment date and preserves it on retries', () => {
		const state = fresh();
		const input = {
			id: 'backdated',
			date: '2026-01-01T05:00:00.000Z',
			description: 'Earlier meal',
			discordNotification: true,
			createdAt: '2000-01-01T00:00:00.000Z',
			lines: [{ memberId: 'linh', amount: 10000, description: '', note: '' }]
		};
		applyCommand(state, 'an', 'createBill', input, now);
		applyCommand(state, 'an', 'createBill', input, '2026-10-26T13:04:05.000Z');
		expect(state.bills.find((bill) => bill.id === input.id)).toMatchObject({
			date: input.date,
			createdAt: now
		});
		expect(state.ledger.find((entry) => entry.reference === input.id)).toMatchObject({
			date: input.date,
			createdAt: now
		});
		expect(dateTimeLabel('2026-10-26T13:04:05.000Z')).toContain('20:04:05');
		expect(dateTimeLabel('2026-10-26T13:04:05.000Z')).toContain('26/10/2026');
	});
	it('sorts backdated bills by creation time and falls back to meal dates for older records', () => {
		const base = fresh().bills[0];
		const newerRecord = { ...base, id: 'new-record', date: '2026-01-01T05:00:00.000Z', createdAt: now };
		const newerMeal = {
			...base,
			id: 'new-meal',
			date: '2026-10-25T05:00:00.000Z',
			createdAt: '2026-10-24T05:00:00.000Z'
		};
		const legacy = { ...base, id: 'legacy', date: '2026-10-23T05:00:00.000Z', createdAt: undefined };
		expect([legacy, newerMeal, newerRecord].sort(compareBillsByCreatedAt).map((bill) => bill.id)).toEqual([
			'new-record',
			'new-meal',
			'legacy'
		]);
	});
	it('sorts transactions by creation time even when payment dates differ, with a legacy fallback', () => {
		const base = fresh().ledger[0];
		const newest = {
			...base,
			id: 'new-record',
			date: '2020-01-01T00:00:00.000Z',
			createdAt: '2026-10-29T05:00:00.000Z'
		};
		const older = {
			...base,
			id: 'new-payment-date',
			date: '2030-01-01T00:00:00.000Z',
			createdAt: '2026-10-27T05:00:00.000Z'
		};
		const legacy = { ...base, id: 'legacy', date: '2026-10-28T05:00:00.000Z', createdAt: undefined };
		expect([older, legacy, newest].sort(compareLedgerEntries).map((entry) => entry.id)).toEqual([
			'new-record',
			'legacy',
			'new-payment-date'
		]);
	});

	it('keeps settlement phase order when creation timestamps tie instead of using payment dates', () => {
		const base = {
			...fresh().ledger[0],
			source: 'settlement' as const,
			reference: 'same-batch',
			createdAt: now
		};
		const phase1 = {
			...base,
			id: 'same-batch-1',
			settlementStep: 1 as const,
			date: '2030-01-01T00:00:00.000Z'
		};
		const phase3 = {
			...base,
			id: 'same-batch-3',
			settlementStep: 3 as const,
			date: '2020-01-01T00:00:00.000Z'
		};
		expect([phase1, phase3].sort(compareLedgerEntries).map((entry) => entry.id)).toEqual([
			'same-batch-3',
			'same-batch-1'
		]);
	});

	it('timestamps all payment, import and settlement entry creation paths', () => {
		const state = fresh();
		const originalIds = new Set(state.ledger.map((entry) => entry.id));
		applyCommand(state, 'an', 'confirmQrPayment', { id: 'qr-time', to: 'linh', amount: 100 }, now);
		const rows = parseLedgerImport(
			JSON.stringify([
				{ id: 'old', from: 'an', to: 'linh', type: 'debt', amount: 100, date: '2020-01-01T00:00:00Z' }
			])
		);
		applyCommand(state, 'an', 'importLedger', { entries: rows }, now);
		applyCommand(state, 'an', 'settleDebts', { id: 'settle-time', version: state.version }, now);
		expect(
			state.ledger.filter((entry) => !originalIds.has(entry.id)).every((entry) => entry.createdAt === now)
		).toBe(true);
		const originalCreatedAt = '2019-12-31T12:34:56.000Z';
		applyCommand(
			state,
			'an',
			'importLedger',
			{ entries: [{ ...rows[0], id: 'old-known-time', createdAt: originalCreatedAt }] },
			now
		);
		expect(state.ledger.find((entry) => entry.id === 'old-known-time')?.createdAt).toBe(originalCreatedAt);
	});
});
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
			const steps = plan.entries.map((entry) => entry.settlementStep!);
			expect(steps).toEqual([...steps].sort((a, b) => a - b));
			applyCommand(state, 'an', 'settleDebts', { id: `settle-${sample}`, version: state.version }, now);
			const saved = state.ledger.filter((entry) => entry.reference === `settle-${sample}`);
			expect(
				[...saved]
					.sort((a, b) => a.id.localeCompare(b.id))
					.sort(compareLedgerEntries)
					.map((entry) => entry.id)
			).toEqual([...saved].reverse().map((entry) => entry.id));
			expect(state.members.map((m) => netBalance(state.ledger, m.id))).toEqual(before);
			expect(before.reduce((s, n) => s + n, 0)).toBe(0);
			expect(state.ledger.filter((e) => e.source === 'settlement').every((e) => e.from !== e.to)).toBe(true);
			expect(plan.hub).toBe(state.members[before.indexOf(Math.min(...before))].id);
		}
	});
	it('orders older simplification phases and numeric indexes after an unordered database read', () => {
		const base = { ...fresh().ledger[0], date: now, source: 'settlement' as const, reference: 'prior' };
		const entries = [
			[1, 3],
			[20, 2],
			[10, 1],
			[2, 1]
		].map(([index, step]) => ({
			...base,
			id: `prior-${index}`,
			description: `Tối giản nợ · Bước ${step}: saved phase`
		}));
		expect(entries.sort(compareLedgerEntries).map((entry) => entry.id)).toEqual([
			'prior-1',
			'prior-20',
			'prior-10',
			'prior-2'
		]);
	});
	it('posts a bill once, includes the payer meal only in the bill, and queues a receipt', () => {
		const state = fresh();
		const before = state.ledger.length;
		const version = state.version;
		const input = {
			id: 'test-bill',
			description: 'Lunch',
			date: now,
			discordNotification: true,
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
		expect(state.receipts.find((r) => r.billId === input.id)?.recipients).toEqual(['an', 'linh']);
		expect(
			state.receipts.find((r) => r.billId === input.id)?.deliveries.every((d) => d.status === 'queued')
		).toBe(true);
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
describe('member profile permissions', () => {
	it('allows an ordinary member to update their own name and bank details', () => {
		const state = fresh();
		const member = state.members.find((person) => person.id === 'linh')!;
		applyCommand(
			state,
			'linh',
			'saveMember',
			{
				...member,
				name: 'Updated member',
				bankName: 'Obsolete account holder',
				email: 'updated@example.test',
				bankLabel: 'MB Bank',
				bankAccount: 'hieu.dao-ăn_01'
			},
			now
		);
		expect(state.members.find((person) => person.id === 'linh')).toMatchObject({
			name: 'Updated member',
			role: 'member',
			active: true,
			bankCode: '970422',
			bankAccount: 'hieu.dao-ăn_01'
		});
		expect(state.members.find((person) => person.id === 'linh')).not.toHaveProperty('bankName');
		expect(state.members.find((person) => person.id === 'linh')).not.toHaveProperty('email');
	});
	it('rejects editing another profile, creating members, privilege changes and self deactivation', () => {
		const state = fresh();
		const member = state.members.find((person) => person.id === 'linh')!;
		for (const changes of [{ id: 'huy' }, { id: 'new-member' }, { role: 'admin' }, { active: false }]) {
			expect(() => applyCommand(state, 'linh', 'saveMember', { ...member, ...changes }, now)).toThrow();
		}
		expect(state.members.find((person) => person.id === 'linh')).toMatchObject({
			role: 'member',
			active: true
		});
		expect(state.members.some((person) => person.id === 'new-member')).toBe(false);
		const admin = state.members.find((person) => person.id === 'an')!;
		expect(() => applyCommand(state, 'an', 'saveMember', { ...admin, role: 'member' }, now)).toThrow();
	});
});
describe('payments', () => {
	it.each(['recordPayment', 'recordPayments', 'renameGroup', 'retryBillNotification', 'saveArchive'])(
		'rejects the removed %s command without changing state',
		(command) => {
			const state = fresh();
			const before = structuredClone(state);
			expect(() => applyCommand(state, 'an', command, {}, now)).toThrow('Thao tác không được hỗ trợ.');
			expect(state).toEqual(before);
		}
	);
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
		applyCommand(state, 'an', 'confirmQrPayment', { id: 'partial', to: 'linh', amount: 1000 }, now);
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
	it('generates an offline VietQR payload with a verified checksum', () => {
		expect(crc16('123456789')).toBe('29B1');
		const payload = vietQrPayload('970436', '00000123', 55000, 'LUNCH TEST');
		expect(payload).toContain('00000123');
		expect(payload).toContain('A000000727');
		expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
	});
	it('preserves the QR payment purpose within the bank memo limit', () => {
		for (const [name, expected] of [
			['Minh An', 'Minh An'],
			['Thảo Linh', 'Thao Linh'],
			['Đăng Khoa', 'Dang Khoa'],
			['Alexandra', 'Alexandra'],
			['Nguyễn Hoàng Minh An', 'Nguyen Hoang Minh An'],
			['A'.repeat(35), 'A'.repeat(35)],
			[`${'Nguyễn '.repeat(6)}An`, 'An']
		]) {
			const message = qrPaymentMessage(name);
			expect(message).toBe(`${expected} tra tien an QR`);
			expect(message.length).toBeLessThanOrEqual(50);
			const payload = vietQrPayload('970436', '00000123', 55000, message);
			expect(payload).toContain(message);
			expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
		}
	});
	it('limits the QR payload description to 50 characters', () => {
		const description = `${'A'.repeat(50)}B`;
		const payload = vietQrPayload('970436', '00000123', 55000, description);
		expect(payload).toContain(`62540850${'A'.repeat(50)}6304`);
		expect(payload).not.toContain(description);
		expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
	});
	it('resolves suggested banks to QR codes and preserves arbitrary bank text without a fabricated code', () => {
		expect(resolveBank('  vIet com bank ')).toEqual({ code: '970436', label: 'Vietcombank' });
		expect(resolveBank('970422')).toEqual({ code: '970422', label: 'MBBank' });
		expect(resolveBank('WRB')).toEqual({ code: '970457', label: 'Woori' });
		expect(resolveBank('ngan hang tmcp kien long')).toEqual({ code: '970452', label: 'KienLongBank' });
		expect(resolveBank('KEBHCM')).toEqual({ code: '970466', label: 'KEBHanaHCMBank' });
		expect(resolveBank('IBKHN')).toEqual({ code: '970455', label: 'IBKHN' });
		expect(resolveBank('IBKHCM')).toEqual({ code: '970456', label: 'IBKHCM' });
		expect(resolveBank('IBK')).toEqual({ code: '', label: 'IBK' });
		const state = fresh();
		const member = state.members.find((member) => member.id === 'linh')!;
		applyCommand(state, 'an', 'saveMember', { ...member, bankLabel: 'Ngân hàng nội bộ' }, now);
		expect(state.members.find((member) => member.id === 'linh')).toMatchObject({
			bankLabel: 'Ngân hàng nội bộ',
			bankCode: ''
		});
	});
});
