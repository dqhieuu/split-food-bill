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
export const currency = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
export const shortCurrency = (value: number) =>
	new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) + ' ₫';
export const dateLabel = (date: string) =>
	new Intl.DateTimeFormat('vi-VN', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone: 'Asia/Ho_Chi_Minh'
	}).format(new Date(date));
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
function requireMember(state: AppState, id: string, active = false): Member {
	const member = state.members.find((m) => m.id === id);
	if (!member || (active && !member.active))
		throw new DomainError('Thành viên không tồn tại hoặc đã ngừng hoạt động.');
	return member;
}
function requireAvailableEntryIds(state: AppState, ids: string[]) {
	const existing = new Set(state.ledger.map((entry) => entry.id));
	if (new Set(ids).size !== ids.length || ids.some((id) => existing.has(id)))
		throw new DomainError('Mã bút toán đã tồn tại. Vui lòng tải lại và thử một giao dịch mới.', 409);
}
export function requireAdmin(state: AppState, actor: string) {
	if (requireMember(state, actor, true).role !== 'admin')
		throw new DomainError('Chỉ quản trị viên được thực hiện thao tác này.', 403);
}
export function settlementPlan(state: AppState): SettlementPlan {
	// Include inactive historical members so no position silently disappears.
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
					description: 'Bù trừ quan hệ nợ cũ',
					note: 'Bút toán điều phối, không phải chuyển khoản',
					source: 'settlement'
				});
		}
	for (const position of positions) {
		if (position.id === hub || position.net === 0) continue;
		entries.push({
			from: position.net < 0 ? position.id : hub,
			to: position.net < 0 ? hub : position.id,
			amount: Math.abs(position.net),
			type: 'debt',
			description: 'Điều phối nợ qua đầu mối',
			note: 'Giữ nguyên số dư ròng của từng người',
			source: 'settlement'
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
				emailReceipt: z.boolean(),
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
		const existing = state.bills.find((b) => b.id === data.id);
		if (existing) {
			if (existing.organizer !== actor) throw new DomainError('Mã hóa đơn đã được sử dụng.', 409);
			return { reference: existing.id };
		}
		if (new Set(data.lines.map((l) => l.memberId)).size !== data.lines.length)
			throw new DomainError('Mỗi thành viên chỉ xuất hiện một lần.');
		for (const line of data.lines) requireMember(state, line.memberId, true);
		const bill: Bill = {
			...data,
			organizer: actor,
			memberNames: Object.fromEntries(state.members.map((m) => [m.id, m.name])),
			total: data.lines.reduce((s, l) => s + l.amount, 0),
			lines: data.lines.map((l) => ({ ...l, description: l.description || data.description }))
		};
		if (!Number.isSafeInteger(bill.total) || bill.total > 1_000_000_000)
			throw new DomainError('Tổng hóa đơn quá lớn.');
		requireAvailableEntryIds(
			state,
			bill.lines.flatMap((line, index) => (line.memberId === actor ? [] : [`${bill.id}-${index}`]))
		);
		state.bills.push(bill);
		bill.lines.forEach((line, i) => {
			if (line.memberId !== actor)
				state.ledger.push({
					id: `${bill.id}-${i}`,
					from: line.memberId,
					to: actor,
					type: 'debt',
					amount: line.amount,
					date: bill.date,
					description: line.description,
					note: line.note,
					creator: actor,
					source: 'bill',
					reference: bill.id
				});
		});
		if (bill.emailReceipt)
			state.receipts.push({
				id: bill.id,
				billId: bill.id,
				status: 'queued',
				recipients: bill.lines.map((l) => requireMember(state, l.memberId).email),
				attempts: 0,
				error: '',
				createdAt: now
			});
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
			creator: actor,
			source: 'manual',
			reference: data.id
		});
		reference = data.id;
	} else if (command === 'confirmQrPayment') {
		const data = z.object({ id: identifier, to: identifier, amount }).parse(input);
		const entryId = `qr-${data.id}`;
		const existing = state.ledger.find((entry) => entry.id === entryId);
		if (existing) {
			if (
				existing.creator !== actor ||
				existing.from !== actor ||
				existing.to !== data.to ||
				existing.amount !== data.amount ||
				existing.source !== 'qr'
			)
				throw new DomainError('Mã thanh toán đã được sử dụng cho một giao dịch khác.', 409);
			return { reference: data.id };
		}
		requireMember(state, data.to);
		if (data.to === actor) throw new DomainError('Không thể thanh toán cho chính mình.');
		state.ledger.push({
			id: entryId,
			from: actor,
			to: data.to,
			type: 'payment',
			amount: data.amount,
			date: now,
			description: 'Xác nhận chuyển khoản bằng QR',
			note: 'Người trả tự xác nhận',
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
		if (!plan.entries.length) throw new DomainError('Không có khoản nợ cần điều phối.');
		requireAvailableEntryIds(
			state,
			plan.entries.map((_, index) => `${data.id}-${index}`)
		);
		plan.entries.forEach((entry, i) =>
			state.ledger.push({ ...entry, id: `${data.id}-${i}`, date: now, creator: actor, reference: data.id })
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
	} else if (command === 'saveMember') {
		requireAdmin(state, actor);
		const data = z
			.object({
				id: identifier,
				name: text,
				email: z.email(),
				active: z.boolean(),
				role: z.enum(['admin', 'member']),
				bankCode: z
					.string()
					.max(30)
					.regex(/^[a-zA-Z0-9]*$/),
				bankLabel: z.string().trim().max(100).optional(),
				bankAccount: z
					.string()
					.max(40)
					.regex(/^[0-9]*$/),
				bankName: z.string().trim().max(100),
				color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
			})
			.parse(input);
		const bank = resolveBank(data.bankLabel ?? data.bankCode);
		data.bankCode = bank.code;
		data.bankLabel = bank.label;
		if (data.id === actor && (!data.active || data.role !== 'admin'))
			throw new DomainError('Bạn không thể tự gỡ quyền quản trị hoặc khóa tài khoản đang dùng.');
		if (state.members.some((m) => m.id !== data.id && m.email.toLowerCase() === data.email.toLowerCase()))
			throw new DomainError('Email đã được sử dụng.');
		const index = state.members.findIndex((m) => m.id === data.id);
		if (index < 0) state.members.push(data);
		else state.members[index] = data;
		reference = data.id;
	} else if (command === 'simulateReceipt') {
		const data = z.object({ id: identifier, fail: z.boolean() }).parse(input);
		const receipt = state.receipts.find((r) => r.id === data.id);
		const bill = state.bills.find((b) => b.id === receipt?.billId);
		if (!receipt || !bill) throw new DomainError('Không tìm thấy biên nhận.', 404);
		if (bill.organizer !== actor) requireAdmin(state, actor);
		receipt.status = data.fail ? 'failed' : 'simulated';
		receipt.attempts++;
		receipt.error = data.fail ? 'Lỗi gửi thử nghiệm. Có thể thử lại mà không ghi thêm khoản nợ.' : '';
		reference = receipt.id;
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
	} else if (command === 'markReleaseSeen') {
		const existing = state.preferences.find((p) => p.id === actor);
		if (existing) existing.lastSeenRelease = '0.1.0';
		else state.preferences.push({ id: actor, lastSeenRelease: '0.1.0' });
		reference = actor;
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
						email: `${id}@example.test`,
						active: false,
						role: 'member',
						bankCode: '',
						bankAccount: '',
						bankName: '',
						color: '#a8a29e'
					});
			state.ledger.push({ ...entry, creator: actor, source: 'import', reference: 'legacy' });
		}
		reference = 'legacy';
	} else throw new DomainError('Thao tác không được hỗ trợ.');
	state.audit.push({ id: crypto.randomUUID(), actor, action: command, date: now, reference });
	state.version++;
	return { reference };
}

export function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
	);
}
export function receiptHtml(bill: Bill, members: Member[]) {
	const name = (id: string) =>
		escapeHtml(bill.memberNames?.[id] || members.find((m) => m.id === id)?.name || id);
	return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f3ec;font-family:Arial,sans-serif;color:#272c27"><table role="presentation" width="100%"><tr><td style="padding:32px 12px"><table role="presentation" style="max-width:600px;margin:auto;background:white;border-radius:16px;width:100%;border-collapse:collapse"><tr><td style="padding:32px"><p style="color:#315e47;font-size:13px;letter-spacing:3px">CHIA TIỀN ĂN</p><h1 style="font-size:26px">Biên nhận hóa đơn</h1><p>${escapeHtml(bill.description)}</p><p>Người thanh toán: <strong>${name(bill.organizer)}</strong> · ${dateLabel(bill.date)}</p><table style="width:100%;text-align:left;border-collapse:collapse"><tr style="border-bottom:1px solid #ddd"><th style="padding:14px 0">Thành viên</th><th>Món ăn</th><th style="text-align:right">Số tiền</th></tr>${bill.lines.map((l) => `<tr><td style="padding:14px 0">${name(l.memberId)}</td><td>${escapeHtml(l.description)}${l.note ? `<br><small>${escapeHtml(l.note)}</small>` : ''}</td><td style="text-align:right">${currency(l.amount)}</td></tr>`).join('')}<tr style="border-top:1px dashed #aaa"><td colspan="2" style="padding:20px 0"><strong>Tổng cộng</strong></td><td style="text-align:right"><strong>${currency(bill.total)}</strong></td></tr></table><p style="color:#777;font-size:12px">Bản xem trước nội bộ · Chưa gửi email · Thanh toán được đối trừ theo từng cặp thành viên.</p></td></tr></table></td></tr></table></body></html>`;
}
