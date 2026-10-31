import { z } from 'zod';
import type { AppState, Bill, LedgerEntry, Member, SettlementPlan } from './types';
import { importEntrySchema } from './import';
import { resolveBank } from './qr';

export class DomainError extends Error {
	constructor(
		message: string,
		public status = 400
	) {
		super(message);
	}
}
const identifier = z.string().regex(/^[\w.-]{1,100}$/);
const text = z.string().trim().min(1).max(300);
const amount = z.number().int().positive().max(1_000_000_000);
/** A server-issued upload name: random UUID plus the extension detected from the image bytes. */
export const BILL_IMAGE_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
export const currency = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
// Vietnamese currency has no decimals: compact labels are whole thousands of đồng.
export const shortCurrency = (value: number) =>
	value === 0 ? '0 ₫' : new Intl.NumberFormat('vi-VN').format(Math.round(value / 1000)) + 'k ₫';
export const dateLabel = (date: string) =>
	new Intl.DateTimeFormat('vi-VN', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone: 'Asia/Ho_Chi_Minh'
	}).format(new Date(date));
export const billDateLabel = (date: string) =>
	new Intl.DateTimeFormat('vi-VN', {
		weekday: 'long',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone: 'Asia/Ho_Chi_Minh'
	})
		.format(new Date(date))
		.toLocaleLowerCase('vi')
		.replace(/\p{L}+/gu, (word) => word[0].toLocaleUpperCase('vi') + word.slice(1));
export const dateTimeLabel = (date?: string) =>
	date
		? new Intl.DateTimeFormat('vi-VN', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hourCycle: 'h23',
				timeZone: 'Asia/Ho_Chi_Minh'
			}).format(new Date(date))
		: 'Không rõ';
export const localDate = (date: string | Date) =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Ho_Chi_Minh',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(date));

export function pairBalance(ledger: LedgerEntry[], from: string, to: string): number {
	if (from === to) return 0;
	return ledger.reduce((sum, entry) => {
		const direction =
			entry.from === from && entry.to === to ? 1 : entry.from === to && entry.to === from ? -1 : 0;
		return sum + direction * entry.amount * (entry.type === 'debt' ? 1 : -1);
	}, 0);
}
export function netBalance(ledger: LedgerEntry[], memberId: string): number {
	return ledger.reduce((sum, entry) => {
		const sign = entry.type === 'debt' ? 1 : -1;
		return (
			sum +
			(entry.to === memberId ? sign * entry.amount : 0) -
			(entry.from === memberId ? sign * entry.amount : 0)
		);
	}, 0);
}
export function splitAmount(total: number, weights: number[]): number[] {
	if (
		!Number.isSafeInteger(total) ||
		total <= 0 ||
		!weights.length ||
		weights.some((w) => !Number.isFinite(w) || w < 0) ||
		weights.reduce((a, b) => a + b, 0) <= 0
	)
		return weights.map(() => 0);
	const sum = weights.reduce((a, b) => a + b, 0);
	const raw = weights.map((w) => (total * w) / sum);
	const result = raw.map(Math.floor);
	const order = raw.map((v, i) => ({ fraction: v - result[i], i })).sort((a, b) => b.fraction - a.fraction);
	const remainder = total - result.reduce((a, b) => a + b, 0);
	for (let i = 0; i < remainder; i++) result[order[i].i]++;
	return result;
}
/** Rounds up to a multiple of 10^digits so the payer never receives less than they paid. */
export function roundUpTo(value: number, digits: number): number {
	const step = 10 ** Math.max(0, Math.floor(digits));
	return Math.ceil(value / step) * step;
}
export function equalShares(total: number, count: number, digits: number): number[] {
	if (!Number.isSafeInteger(total) || total <= 0 || count <= 0) return Array(Math.max(0, count)).fill(0);
	if (digits === 0) return discountShares(Array(count).fill(1), total);
	return Array(count).fill(roundUpTo(total / count, digits));
}
/**
 * Scales listed prices to the discounted bill total. With no rounding step, the last person
 * absorbs the difference in whole đồng; otherwise every share rounds up independently.
 */
export function discountShares(amounts: number[], discountedTotal: number, digits = 0): number[] {
	const sum = amounts.reduce((a, b) => a + b, 0);
	if (!amounts.length || sum <= 0 || !Number.isSafeInteger(discountedTotal) || discountedTotal <= 0)
		return amounts;
	if (digits > 0) return amounts.map((amount) => roundUpTo((amount * discountedTotal) / sum, digits));
	const shares = amounts.map((amount) => Math.round((amount * discountedTotal) / sum));
	shares[shares.length - 1] = discountedTotal - shares.slice(0, -1).reduce((a, b) => a + b, 0);
	return shares;
}
/** Ledger entries cancelled by an undo, together with their reversal entries. */
export function cancelledEntryIds(ledger: LedgerEntry[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of ledger)
		if (entry.source === 'reversal') {
			ids.add(entry.id);
			ids.add(entry.id.replace(/-undo$/, ''));
		}
	return ids;
}
function requireMember(state: AppState, id: string, active = false): Member {
	const member = state.members.find((m) => m.id === id);
	if (!member || (active && !member.active))
		throw new DomainError('Thành viên không tồn tại hoặc đã ngừng hoạt động.');
	return member;
}
function requireAvailableEntryIds(state: AppState, ids: string[]) {
	const existing = new Set(state.ledger.map((entry) => entry.id));
	if (new Set(ids).size !== ids.length || ids.some((id) => existing.has(id)))
		throw new DomainError('Mã giao dịch đã tồn tại. Vui lòng tải lại và thử một giao dịch mới.', 409);
}
export function requireAdmin(state: AppState, actor: string) {
	if (requireMember(state, actor, true).role !== 'admin')
		throw new DomainError('Chỉ quản trị viên được thực hiện thao tác này.', 403);
}
/** Bill lists use recording time; the meal date can refer to an earlier day. */
export function compareBillsByCreatedAt(a: Bill, b: Bill): number {
	return (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date) || b.id.localeCompare(a.id);
}

/** Newest creation first (legacy entries fall back to date), then the last simplification phase. */
export function compareLedgerEntries(a: LedgerEntry, b: LedgerEntry): number {
	const dateOrder = (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date);
	if (dateOrder) return dateOrder;
	const batchKey = (entry: LedgerEntry) =>
		entry.source === 'settlement' ? `settlement:${entry.reference}` : `entry:${entry.id}`;
	const batchOrder = batchKey(b).localeCompare(batchKey(a));
	if (batchOrder) return batchOrder;
	if (a.source === 'settlement' && b.source === 'settlement') {
		// Existing batches predate explicit phase metadata; their saved labels retain the phase.
		const step = (entry: LedgerEntry) =>
			entry.settlementStep ?? Number(entry.description.match(/Bước ([123]):/)?.[1] ?? 0);
		const index = (entry: LedgerEntry) => {
			const suffix = entry.id.slice(entry.reference.length + 1);
			return /^\d+$/.test(suffix) ? Number(suffix) : Number.MAX_SAFE_INTEGER;
		};
		return step(b) - step(a) || index(b) - index(a) || b.id.localeCompare(a.id);
	}
	return a.id.localeCompare(b.id);
}

/**
 * Port of `minimizeTransactions` in lunchsheet.gs (Proof-of-Anti-Stake):
 * 1. every pairwise balance is zeroed with a payment from the debtor to the creditor;
 * 2. each net debtor owes the hub (the member with the lowest net position);
 * 3. the hub owes each net creditor.
 * Every member's net position is preserved. Inactive members are included so no position disappears.
 */
export function settlementPlan(state: AppState): SettlementPlan {
	const positions = state.members.map((m) => ({ id: m.id, net: netBalance(state.ledger, m.id) }));
	const hub = [...positions].sort((a, b) => a.net - b.net)[0]?.id ?? '';
	const entries: SettlementPlan['entries'] = [];
	for (let i = 0; i < state.members.length; i++)
		for (let j = i + 1; j < state.members.length; j++) {
			const a = state.members[i].id,
				b = state.members[j].id;
			const balance = pairBalance(state.ledger, a, b);
			if (balance)
				entries.push({
					from: balance > 0 ? a : b,
					to: balance > 0 ? b : a,
					amount: Math.abs(balance),
					type: 'payment',
					description: 'Tối giản nợ · Bước 1: Cân bằng nợ nần về 0',
					note: '',
					source: 'settlement',
					settlementStep: 1
				});
		}
	for (const position of [...positions.filter((p) => p.net < 0), ...positions.filter((p) => p.net > 0)]) {
		if (position.id === hub || position.net === 0) continue;
		entries.push({
			from: position.net < 0 ? position.id : hub,
			to: position.net < 0 ? hub : position.id,
			amount: Math.abs(position.net),
			type: 'debt',
			description:
				position.net < 0
					? 'Tối giản nợ · Bước 2: Người nợ trả tiền cho nợ chúa'
					: 'Tối giản nợ · Bước 3: Nợ chúa trả tiền cho người bị nợ',
			note: '',
			source: 'settlement',
			settlementStep: position.net < 0 ? 2 : 3
		});
	}
	return { version: state.version, hub, entries };
}

export function applyCommand(
	state: AppState,
	actor: string,
	command: string,
	input: unknown,
	now = new Date().toISOString()
): { reference?: string } {
	requireMember(state, actor, true);
	let reference = '';
	if (command === 'createBill') {
		const data = z
			.object({
				id: identifier,
				description: text,
				date: z.iso.datetime(),
				payerId: identifier.optional(),
				discordNotification: z.boolean(),
				alreadyPaid: z.boolean().optional().default(false),
				image: z.string().regex(BILL_IMAGE_ID).optional(),
				lines: z
					.array(
						z.object({
							memberId: identifier,
							amount,
							description: z.string().trim().max(300),
							note: z.string().trim().max(500)
						})
					)
					.min(1)
					.max(100)
			})
			.parse(input);
		const payerId = data.payerId ?? actor;
		if (payerId !== actor) requireAdmin(state, actor);
		const existing = state.bills.find((b) => b.id === data.id);
		if (existing) {
			if ((existing.creator ?? existing.organizer) !== actor || existing.organizer !== payerId)
				throw new DomainError('Mã hóa đơn đã được sử dụng.', 409);
			if (!!existing.alreadyPaid !== data.alreadyPaid)
				throw new DomainError('Hóa đơn đã được ghi với trạng thái thanh toán khác. Vui lòng tải lại.', 409);
			return { reference: existing.id };
		}
		if (new Set(data.lines.map((l) => l.memberId)).size !== data.lines.length)
			throw new DomainError('Mỗi thành viên chỉ xuất hiện một lần.');
		requireMember(state, payerId, true);
		for (const line of data.lines) requireMember(state, line.memberId, true);
		const { payerId: _payerId, ...billData } = data;
		const bill: Bill = {
			...billData,
			createdAt: now,
			organizer: payerId,
			creator: actor,
			memberNames: Object.fromEntries(state.members.map((m) => [m.id, m.name])),
			total: data.lines.reduce((s, l) => s + l.amount, 0),
			lines: data.lines.map((l) => ({ ...l, description: l.description || data.description }))
		};
		if (!Number.isSafeInteger(bill.total) || bill.total > 1_000_000_000)
			throw new DomainError('Tổng hóa đơn quá lớn.');
		requireAvailableEntryIds(
			state,
			bill.lines.flatMap((line, index) =>
				line.memberId === payerId
					? []
					: [`${bill.id}-${index}`, ...(bill.alreadyPaid ? [`${bill.id}-${index}-paid`] : [])]
			)
		);
		state.bills.push(bill);
		bill.lines.forEach((line, i) => {
			if (line.memberId !== payerId) {
				state.ledger.push({
					id: `${bill.id}-${i}`,
					from: line.memberId,
					to: payerId,
					type: 'debt',
					amount: line.amount,
					date: bill.date,
					createdAt: now,
					description: line.description,
					note: line.note,
					creator: actor,
					source: 'bill',
					reference: bill.id
				});
				if (bill.alreadyPaid)
					state.ledger.push({
						id: `${bill.id}-${i}-paid`,
						from: line.memberId,
						to: payerId,
						type: 'payment',
						amount: line.amount,
						date: bill.date,
						createdAt: now,
						description: `Đã thanh toán: ${line.description}`,
						note: '',
						creator: actor,
						source: 'bill',
						reference: bill.id
					});
			}
		});
		if (bill.discordNotification)
			state.receipts.push({
				id: bill.id,
				billId: bill.id,
				status: 'queued',
				recipients: bill.lines.map((line) => line.memberId),
				deliveries: bill.lines.map((line) => ({ memberId: line.memberId, status: 'queued', error: '' })),
				attempts: 0,
				error: '',
				createdAt: now
			});
		reference = bill.id;
	} else if (command === 'undoBill') {
		const { id } = z.object({ id: identifier }).parse(input);
		const bill = state.bills.find((b) => b.id === id);
		if (!bill) throw new DomainError('Không tìm thấy hóa đơn.', 404);
		if (bill.organizer !== actor && requireMember(state, actor, true).role !== 'admin')
			throw new DomainError('Chỉ người trả hóa đơn hoặc quản trị viên được hoàn tác.', 403);
		if (bill.undoneAt) throw new DomainError('Hóa đơn đã được hoàn tác và không thể hoàn tác lại.', 409);
		const entries = state.ledger.filter((entry) => entry.source === 'bill' && entry.reference === bill.id);
		requireAvailableEntryIds(
			state,
			entries.map((entry) => `${entry.id}-undo`)
		);
		// Reverse debts and any already-paid repayments together without changing the original entries.
		for (const entry of entries)
			state.ledger.push({
				id: `${entry.id}-undo`,
				from: entry.to,
				to: entry.from,
				type: entry.type,
				amount: entry.amount,
				date: now,
				createdAt: now,
				description: `Hoàn tác: ${entry.description}`,
				note: '',
				creator: actor,
				source: 'reversal',
				reference: bill.id
			});
		bill.undoneAt = now;
		bill.undoneBy = actor;
		reference = bill.id;
	} else if (command === 'recordPayments') {
		const data = z
			.object({
				id: identifier,
				description: text,
				note: z.string().trim().max(500),
				payments: z
					.array(z.object({ to: identifier, amount }))
					.min(1)
					.max(100)
			})
			.parse(input);
		const existing = state.ledger.find((entry) => entry.reference === data.id);
		if (existing) {
			if (existing.creator !== actor) throw new DomainError('Mã giao dịch đã được sử dụng.', 409);
			return { reference: data.id };
		}
		if (new Set(data.payments.map((payment) => payment.to)).size !== data.payments.length)
			throw new DomainError('Mỗi người nhận chỉ được xuất hiện một lần.');
		for (const payment of data.payments) {
			requireMember(state, payment.to);
			if (payment.to === actor) throw new DomainError('Không thể thanh toán cho chính mình.');
		}
		requireAvailableEntryIds(
			state,
			data.payments.map((_, index) => `${data.id}-${index}`)
		);
		data.payments.forEach((payment, index) =>
			state.ledger.push({
				id: `${data.id}-${index}`,
				from: actor,
				to: payment.to,
				type: 'payment',
				amount: payment.amount,
				date: now,
				createdAt: now,
				description: data.description,
				note: data.note,
				creator: actor,
				source: 'manual',
				reference: data.id
			})
		);
		reference = data.id;
	} else if (command === 'recordPayment') {
		const data = z
			.object({ id: identifier, to: identifier, amount, description: text, note: z.string().trim().max(500) })
			.parse(input);
		const existing = state.ledger.find((e) => e.id === data.id);
		if (existing) {
			if (existing.creator !== actor) throw new DomainError('Mã giao dịch đã được sử dụng.', 409);
			return { reference: existing.id };
		}
		requireMember(state, data.to);
		if (data.to === actor) throw new DomainError('Không thể thanh toán cho chính mình.');
		state.ledger.push({
			...data,
			from: actor,
			type: 'payment',
			date: now,
			createdAt: now,
			creator: actor,
			source: 'manual',
			reference: data.id
		});
		reference = data.id;
	} else if (command === 'confirmQrPayment') {
		const data = z
			.object({ id: identifier, to: identifier, from: identifier.optional(), amount })
			.parse(input);
		const payer = data.from ?? actor;
		if (payer !== actor) requireAdmin(state, actor);
		const entryId = `qr-${data.id}`;
		const existing = state.ledger.find((entry) => entry.id === entryId);
		if (existing) {
			if (
				existing.creator !== actor ||
				existing.from !== payer ||
				existing.to !== data.to ||
				existing.amount !== data.amount ||
				existing.source !== 'qr'
			)
				throw new DomainError('Mã thanh toán đã được sử dụng cho một giao dịch khác.', 409);
			return { reference: data.id };
		}
		requireMember(state, payer);
		requireMember(state, data.to);
		if (data.to === payer) throw new DomainError('Không thể thanh toán cho chính mình.');
		state.ledger.push({
			id: entryId,
			from: payer,
			to: data.to,
			type: 'payment',
			amount: data.amount,
			date: now,
			createdAt: now,
			description: payer === actor ? 'Auto trả tiền bằng QR' : 'Quản trị viên xác nhận thanh toán bằng QR',
			note: '',
			creator: actor,
			source: 'qr',
			reference: data.id
		});
		reference = data.id;
	} else if (command === 'settleDebts') {
		requireAdmin(state, actor);
		const data = z.object({ id: identifier, version: z.number().int() }).parse(input);
		if (state.settlements.some((s) => s.id === data.id)) return { reference: data.id };
		if (data.version !== state.version)
			throw new DomainError('Ledger đã thay đổi. Vui lòng xem lại phương án mới.', 409);
		const plan = settlementPlan(state);
		if (!plan.entries.length) throw new DomainError('Không có khoản nợ cần tối giản.');
		requireAvailableEntryIds(
			state,
			plan.entries.map((_, index) => `${data.id}-${index}`)
		);
		plan.entries.forEach((entry, i) =>
			state.ledger.push({
				...entry,
				id: `${data.id}-${i}`,
				date: now,
				createdAt: now,
				creator: actor,
				reference: data.id
			})
		);
		state.settlements.push({
			id: data.id,
			hub: plan.hub,
			date: now,
			creator: actor,
			version: data.version,
			entryCount: plan.entries.length
		});
		reference = data.id;
	} else if (command === 'undoSettlement') {
		requireAdmin(state, actor);
		const { id } = z.object({ id: identifier }).parse(input);
		const batch = state.settlements.find((settlement) => settlement.id === id);
		if (!batch) throw new DomainError('Không tìm thấy lần tối giản nợ.', 404);
		// A retry after a lost response must not reverse the same batch twice.
		if (batch.undoneAt) return { reference: batch.id };
		const entries = state.ledger.filter(
			(entry) => entry.source === 'settlement' && entry.reference === batch.id
		);
		if (!entries.length || entries.length !== batch.entryCount)
			throw new DomainError('Không tìm thấy đầy đủ giao dịch của lần tối giản này.', 409);
		requireAvailableEntryIds(
			state,
			entries.map((entry) => `${entry.id}-undo`)
		);
		for (const entry of entries)
			state.ledger.push({
				id: `${entry.id}-undo`,
				from: entry.to,
				to: entry.from,
				type: entry.type,
				amount: entry.amount,
				date: now,
				createdAt: now,
				description: `Hoàn tác: ${entry.description}`,
				note: '',
				creator: actor,
				source: 'reversal',
				reference: batch.id
			});
		batch.undoneAt = now;
		batch.undoneBy = actor;
		reference = batch.id;
	} else if (command === 'saveMember') {
		const editor = requireMember(state, actor, true);
		const data = z
			.object({
				id: identifier,
				name: text,
				active: z.boolean(),
				role: z.enum(['admin', 'member']),
				bankCode: z
					.string()
					.max(30)
					.regex(/^[a-zA-Z0-9]*$/),
				bankLabel: z.string().trim().max(100).optional(),
				bankAccount: z.string().max(40),
				color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
			})
			.parse(input);
		const existing = state.members.find((member) => member.id === data.id);
		if (editor.role !== 'admin') {
			if (data.id !== actor || !existing)
				throw new DomainError('Bạn chỉ được chỉnh sửa hồ sơ của mình.', 403);
			if (data.role !== existing.role || data.active !== existing.active)
				throw new DomainError('Bạn không được thay đổi vai trò hoặc trạng thái tài khoản.', 403);
		}
		const bank = resolveBank(data.bankLabel ?? data.bankCode);
		data.bankCode = bank.code;
		data.bankLabel = bank.label;
		if (data.id === actor && (!data.active || data.role !== editor.role))
			throw new DomainError('Bạn không thể tự gỡ quyền quản trị hoặc khóa tài khoản đang dùng.');
		const index = state.members.findIndex((m) => m.id === data.id);
		if (index < 0) state.members.push(data);
		else
			state.members[index] = { ...data, ...(existing?.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}) };
		reference = data.id;
	} else if (command === 'saveArchive') {
		requireAdmin(state, actor);
		const data = z
			.object({
				id: identifier,
				name: text,
				url: z.url().refine((v) => ['https:', 'http:'].includes(new URL(v).protocol)),
				date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
			})
			.parse(input);
		state.archives.push(data);
		reference = data.id;
	} else if (command === 'importLedger') {
		requireAdmin(state, actor);
		const data = z.object({ entries: z.array(importEntrySchema).min(1).max(150) }).parse(input);
		for (const entry of data.entries) {
			const existing = state.ledger.find((e) => e.id === entry.id);
			if (existing) {
				if (
					['from', 'to', 'type', 'amount', 'date', 'description', 'note'].some(
						(key) => existing[key as keyof LedgerEntry] !== entry[key as keyof typeof entry]
					)
				)
					throw new DomainError('Mã giao dịch đã tồn tại với nội dung khác. Dừng nhập để kiểm tra.', 409);
				continue;
			}
			for (const id of [entry.from, entry.to])
				if (!state.members.some((m) => m.id === id))
					state.members.push({
						id,
						name: id,
						active: false,
						role: 'member',
						bankCode: '',
						bankAccount: '',
						color: '#a8a29e'
					});
			state.ledger.push({
				...entry,
				createdAt: entry.createdAt ?? now,
				creator: actor,
				source: 'import',
				reference: 'legacy'
			});
		}
		reference = 'legacy';
	} else throw new DomainError('Thao tác không được hỗ trợ.');
	state.audit.push({ id: crypto.randomUUID(), actor, action: command, date: now, reference });
	state.version++;
	return { reference };
}
